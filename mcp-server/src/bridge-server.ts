/**
 * Bridge Server — 独立守护进程
 *
 * 架构: MCP Server (多) ←ws→ Bridge Server ←ws→ Chrome Extension (单)
 * 职责:
 * 1. 管理多个 MCP Server 客户端连接
 * 2. 管理单个 Chrome Extension 连接
 * 3. 按 requestId 路由工具调用请求/响应
 * 4. 处理 Extension → CC CLI 的反向请求
 */

import { WebSocketServer, WebSocket } from "ws"
import { spawn, execSync } from "node:child_process"
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const BRIDGE_PORT = 9527
const PID_FILE = join(tmpdir(), "page-pilot-bridge.pid")

// ========== 消息类型 ==========

/** MCP → Bridge: 工具调用请求 */
interface MCPToolRequest {
  type: "tool_call"
  id: string
  tool: string
  args: Record<string, any>
}

/** Extension → Bridge: 工具调用响应 */
interface ExtensionResponse {
  id: string
  result?: any
  error?: string
}

/** Extension → Bridge: CC 反向请求 */
interface CCRequest {
  type: "cc_request"
  id: string
  action: "invoke_skill" | "ask_prompt" | "list_skills"
  skill?: string
  args?: Record<string, any>
  prompt?: string
}

/** 注册消息 */
interface RegisterMessage {
  type: "register"
  role: "mcp" | "extension"
}

type MCPClient = {
  ws: WebSocket
  id: string
}

type PendingToolCall = {
  mcpId: string // 来自哪个 MCP 客户端
}

type PendingCCRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CCProcess = {
  process: ReturnType<typeof spawn>
  timer: ReturnType<typeof setTimeout>
}

// ========== Bridge Server ==========

export class BridgeServer {
  private wss: WebSocketServer | null = null
  private mcpClients = new Map<string, MCPClient>() // mcpId → client
  private extensionWs: WebSocket | null = null

  // 工具调用路由: requestId → mcpId
  private pendingToolCalls = new Map<string, PendingToolCall>()

  // CC 反向请求
  private pendingCCRequests = new Map<string, PendingCCRequest>()
  private ccRequestCounter = 0
  private claudePath: string
  private activeProcesses: CCProcess[] = []
  private maxConcurrency = 2
  private requestQueue: CCRequest[] = []

  constructor(port: number = BRIDGE_PORT) {
    this.claudePath = process.env.CLAUDE_CLI_PATH || "claude"

    try {
      this.wss = new WebSocketServer({ port })
      this.writePidFile()
    } catch {
      console.error(`[Bridge] ❌ 端口 ${port} 启动失败`)
      process.exit(1)
    }

    this.wss.on("connection", (ws) => this.handleConnection(ws))
    this.wss.on("error", (err) => {
      if ((err as any).code === "EADDRINUSE") {
        console.error(`[Bridge] ❌ 端口 ${port} 已被占用`)
        process.exit(1)
      }
    })

    this.detectClaudeCLI()
    console.log(`[Bridge] WebSocket Server 已启动，端口: ${port}`)
    console.log(`[Bridge] PID 文件: ${PID_FILE}`)
    console.log(`[Bridge] 等待连接...`)

    // 定期清理断开的客户端
    setInterval(() => this.cleanupStaleClients(), 30_000)
  }

  private writePidFile() {
    writeFileSync(PID_FILE, String(process.pid), "utf-8")
  }

  private detectClaudeCLI() {
    try {
      const result = execSync(`which ${this.claudePath} 2>/dev/null || where ${this.claudePath} 2>nul`, {
        encoding: "utf-8",
        timeout: 3000,
      })
      console.log(`[Bridge] Claude CLI: ${result.trim()}`)
    } catch {
      console.warn(`[Bridge] ⚠️ 未找到 Claude CLI (${this.claudePath})，CC 功能不可用`)
    }
  }

  // ========== 连接管理 ==========

  private handleConnection(ws: WebSocket) {
    let role: "mcp" | "extension" | null = null
    let mcpId: string | null = null

    // 等待注册消息
    const registerHandler = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString())

        // 注册消息
        if (msg.type === "register") {
          role = msg.role
          ws.removeListener("message", registerHandler)

          if (role === "mcp") {
            mcpId = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            this.mcpClients.set(mcpId, { ws, id: mcpId })
            // 通知 MCP 客户端其 ID
            ws.send(JSON.stringify({ type: "registered", mcpId }))
            console.log(`[Bridge] MCP 客户端已连接: ${mcpId} (共 ${this.mcpClients.size} 个)`)
            ws.on("message", (data) => this.handleMCPMessage(mcpId, data))
          } else {
            this.extensionWs = ws
            console.log(`[Bridge] Chrome Extension 已连接`)
            ws.on("message", (data) => this.handleExtensionMessage(data))
          }

          ws.on("close", () => {
            if (role === "mcp" && mcpId) {
              this.mcpClients.delete(mcpId)
              // 清理该 MCP 客户端的待处理请求
              for (const [reqId, pending] of this.pendingToolCalls) {
                if (pending.mcpId === mcpId) this.pendingToolCalls.delete(reqId)
              }
              console.log(`[Bridge] MCP 客户端已断开: ${mcpId} (剩余 ${this.mcpClients.size} 个)`)
            } else if (role === "extension") {
              this.extensionWs = null
              console.log(`[Bridge] Chrome Extension 已断开`)
            }
          })

          return
        }

        // 未注册，忽略
        console.warn("[Bridge] 收到未注册连接的消息，忽略")
      } catch {
        // 忽略解析错误
      }
    }

    ws.on("message", registerHandler)
  }

  private cleanupStaleClients() {
    for (const [id, client] of this.mcpClients) {
      if (client.ws.readyState === WebSocket.CLOSED || client.ws.readyState === WebSocket.CLOSING) {
        this.mcpClients.delete(id)
        console.log(`[Bridge] 清理断开的 MCP 客户端: ${id}`)
      }
    }
  }

  // ========== MCP → Extension (工具调用) ==========

  private handleMCPMessage(mcpId: string, raw: WebSocket.RawData) {
    try {
      const msg = JSON.parse(raw.toString()) as MCPToolRequest

      if (msg.type !== "tool_call") return

      if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
        // Extension 未连接，直接返回错误
        const client = this.mcpClients.get(mcpId)
        client?.ws.send(
          JSON.stringify({
            type: "tool_response",
            id: msg.id,
            error: "Chrome Extension 未连接",
          })
        )
        return
      }

      // 记录路由: requestId → mcpId
      this.pendingToolCalls.set(msg.id, { mcpId })

      // 转发给 Extension（去掉 type 字段，保持与原协议兼容）
      this.extensionWs.send(
        JSON.stringify({
          id: msg.id,
          tool: msg.tool,
          args: msg.args,
        })
      )
    } catch (e) {
      console.error("[Bridge] 处理 MCP 消息失败:", e)
    }
  }

  // ========== Extension → MCP (工具响应) + CC 反向请求 ==========

  private handleExtensionMessage(raw: WebSocket.RawData) {
    try {
      const msg = JSON.parse(raw.toString())

      // CC 反向请求
      if (msg.type === "cc_request") {
        this.enqueueCCRequest(msg as CCRequest)
        return
      }

      // 工具调用响应
      const resp = msg as ExtensionResponse
      if (!resp.id) return

      const pending = this.pendingToolCalls.get(resp.id)
      if (!pending) {
        console.warn(`[Bridge] 未找到待处理请求: ${resp.id}`)
        return
      }

      this.pendingToolCalls.delete(resp.id)

      const client = this.mcpClients.get(pending.mcpId)
      if (!client || client.ws.readyState !== WebSocket.OPEN) {
        console.warn(`[Bridge] MCP 客户端已断开: ${pending.mcpId}`)
        return
      }

      // 转发响应给 MCP 客户端
      client.ws.send(
        JSON.stringify({
          type: "tool_response",
          id: resp.id,
          result: resp.result,
          error: resp.error,
        })
      )
    } catch (e) {
      console.error("[Bridge] 处理 Extension 消息失败:", e)
    }
  }

  // ========== CC CLI 执行（与原 bridge.ts 逻辑一致）==========

  private enqueueCCRequest(req: CCRequest) {
    this.requestQueue.push(req)
    this.processQueue()
  }

  private processQueue() {
    while (this.activeProcesses.length < this.maxConcurrency && this.requestQueue.length > 0) {
      const req = this.requestQueue.shift()!
      this.executeCCRequest(req)
    }
  }

  private async executeCCRequest(req: CCRequest) {
    const start = Date.now()
    try {
      let result: any
      switch (req.action) {
        case "list_skills":
          result = await this.listSkillsCLI()
          break
        case "invoke_skill":
          result = await this.executeClaudeCLI(this.buildSkillPrompt(req.skill!, req.args), 120_000)
          break
        case "ask_prompt":
          result = await this.executeClaudeCLI(req.prompt!, 60_000)
          break
        default:
          throw new Error(`未知 action: ${req.action}`)
      }
      this.sendCCResponse(req.id, { output: result, duration: Date.now() - start })
    } catch (e: any) {
      this.sendCCResponse(req.id, undefined, e.message || "执行失败")
    } finally {
      this.activeProcesses = this.activeProcesses.filter((p) => p.process.pid !== undefined)
      this.processQueue()
    }
  }

  private buildSkillPrompt(skill: string, args?: Record<string, any>): string {
    const argsStr = args ? `\n\n参数: ${JSON.stringify(args)}` : ""
    return `请执行 skill: ${skill}${argsStr}`
  }

  private async listSkillsCLI(): Promise<Array<{ name: string; description: string }>> {
    const output = await this.executeClaudeCLI("列出所有可用的 skills 名称和简短描述，用 JSON 格式返回", 30_000)
    try {
      const jsonMatch = output.match(/\[[\s\S]*\]/)
      if (jsonMatch) return JSON.parse(jsonMatch[0])
    } catch {
      // 解析失败
    }
    return [{ name: "raw-output", description: output.slice(0, 200) }]
  }

  private executeClaudeCLI(prompt: string, timeout = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ["-p", prompt, "--output-format", "text"]
      const proc = spawn(this.claudePath, args, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
      proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))

      const timer = setTimeout(() => {
        proc.kill("SIGTERM")
        reject(new Error(`Claude CLI 执行超时 (${timeout}ms)`))
      }, timeout)

      const ccProc: CCProcess = { process: proc, timer }
      this.activeProcesses.push(ccProc)

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || `Claude CLI 退出码: ${code}`))
      })

      proc.on("error", (err) => {
        clearTimeout(timer)
        reject(new Error(`Claude CLI 启动失败: ${err.message}`))
      })
    })
  }

  private sendCCResponse(id: string, result?: any, error?: string) {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) return
    this.extensionWs.send(JSON.stringify({ type: "cc_response", id, result, error }))
  }

  // ========== 生命周期 ==========

  close() {
    for (const ccProc of this.activeProcesses) {
      clearTimeout(ccProc.timer)
      ccProc.process.kill("SIGTERM")
    }
    this.activeProcesses = []
    this.requestQueue = []

    for (const [, pending] of this.pendingCCRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Bridge 已关闭"))
    }
    this.pendingCCRequests.clear()

    // 关闭所有客户端连接
    for (const [, client] of this.mcpClients) {
      client.ws.close()
    }
    this.mcpClients.clear()
    this.extensionWs = null

    this.wss?.close()

    // 清理 PID 文件
    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    } catch {
      // 忽略
    }
  }
}

// ========== 启动入口 ==========

/** 检查是否已有 Bridge 在运行 */
export function isBridgeRunning(): boolean {
  if (!existsSync(PID_FILE)) return false
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10)
    // 发送 signal 0 检查进程是否存活
    process.kill(pid, 0)
    return true
  } catch {
    // 进程不存在，清理 PID 文件
    try { unlinkSync(PID_FILE) } catch { /* 忽略 */ }
    return false
  }
}

/** 启动独立 Bridge 进程（MCP Server 调用） */
export function spawnBridgeProcess(): void {
  if (isBridgeRunning()) return

  // 用 import.meta.url 解析 bridge-standalone.js 的路径
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const bridgeScript = join(__dirname, "bridge-standalone.js")

  if (!existsSync(bridgeScript)) {
    console.error(`[MCP] Bridge 脚本不存在: ${bridgeScript}`)
    return
  }

  const child = spawn(process.execPath, [bridgeScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
    cwd: __dirname, // 确保 node_modules 可被找到
  })
  child.unref()

  // 异步轮询等待 Bridge 启动（避免阻塞）
  let attempts = 0
  const checkInterval = setInterval(() => {
    attempts++
    if (isBridgeRunning()) {
      clearInterval(checkInterval)
      console.error("[MCP] Bridge Server 已自动启动")
    } else if (attempts >= 30) {
      clearInterval(checkInterval)
      console.error("[MCP] Bridge 启动超时（3s）")
    }
  }, 100)
}
