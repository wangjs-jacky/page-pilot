import { WebSocketServer, WebSocket } from "ws"
import { spawn, execSync } from "node:child_process"

// Bridge 消息类型 — CC → Extension 方向
interface BridgeMessage {
  id: string
  tool: string
  args: Record<string, any>
}

// Extension → Bridge 响应（对应 MCP 工具调用）
interface BridgeResponse {
  id: string
  result?: any
  error?: string
}

// Extension → Bridge 请求（触发 Claude CLI）
interface CCRequest {
  type: "cc_request"
  id: string
  action: "invoke_skill" | "ask_prompt" | "list_skills"
  skill?: string
  args?: Record<string, any>
  prompt?: string
}

// Bridge → Extension 响应（CC CLI 执行结果）
interface CCResponse {
  type: "cc_response"
  id: string
  result?: any
  error?: string
}

type PendingRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type CCProcess = {
  process: ReturnType<typeof spawn>
  timer: ReturnType<typeof setTimeout>
}

/**
 * WebSocket Bridge — MCP Server 与 Chrome Extension 之间的通信桥梁
 *
 * 职责:
 * 1. 监听 WebSocket 连接（来自 Chrome Extension）
 * 2. 转发 MCP 工具调用请求到 Extension
 * 3. 将 Extension 的执行结果返回给 MCP
 */
export class Bridge {
  private wss: WebSocketServer | null = null
  private extWs: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private msgCounter = 0
  private _bridgeReady = false

  // CC CLI 相关
  private claudePath: string
  private activeProcesses: CCProcess[] = []
  private maxConcurrency = 2
  private requestQueue: CCRequest[] = []

  constructor(port: number = 9527) {
    this.claudePath = process.env.CLAUDE_CLI_PATH || "claude"

    try {
      this.wss = new WebSocketServer({ port })
      this._bridgeReady = true
    } catch {
      this._bridgeReady = false
      console.error(`[Bridge] ❌ 端口 ${port} 启动失败。工具调用将返回错误。`)
    }

    this.wss?.on("connection", (ws) => this.handleConnection(ws))
    this.wss?.on("error", (err) => {
      if ((err as any).code === "EADDRINUSE") {
        this._bridgeReady = false
        console.error(`[Bridge] ❌ 端口 ${port} 已被占用，可能已有其他 Claude Code 会话在运行。`)
        console.error(`[Bridge] 请关闭其他会话或 kill 旧 MCP 进程: lsof -i :${port}`)
      } else {
        console.error("[Bridge] WebSocket Server 错误:", err.message)
      }
    })

    // 检测 Claude CLI 是否可用
    this.detectClaudeCLI()

    if (this._bridgeReady) {
      console.log(`[Bridge] WebSocket Server 已启动，端口: ${port}`)
      console.log(`[Bridge] 等待 Chrome Extension 连接...`)
    }
  }

  /** Bridge 是否可用（端口绑定成功） */
  get bridgeReady(): boolean {
    return this._bridgeReady
  }

  private detectClaudeCLI() {
    try {
      const result = execSync(`which ${this.claudePath} 2>/dev/null || where ${this.claudePath} 2>nul`, {
        encoding: "utf-8",
        timeout: 3000,
      })
      console.log(`[Bridge] Claude CLI 已找到: ${result.trim()}`)
    } catch {
      console.warn(`[Bridge] ⚠️ 未在 PATH 中找到 Claude CLI (${this.claudePath})，CC 功能不可用`)
    }
  }

  private handleConnection(ws: WebSocket) {
    this.extWs = ws
    console.log("[Bridge] Chrome Extension 已连接")

    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString())

        // Extension → Bridge 反向请求（触发 Claude CLI）
        if (parsed.type === "cc_request") {
          this.enqueueCCRequest(parsed as CCRequest)
          return
        }

        // Extension → Bridge 响应（对应 MCP 工具调用）
        const msg = parsed as BridgeResponse
        const pending = this.pending.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(msg.id)
          if (msg.error) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
        }
      } catch (e) {
        console.error("[Bridge] 解析消息失败:", e)
      }
    })

    ws.on("close", () => {
      console.log("[Bridge] Chrome Extension 已断开")
      this.extWs = null
    })

    ws.on("error", (err) => {
      console.error("[Bridge] WebSocket 连接错误:", err.message)
      this.extWs = null
    })
  }

  /**
   * 发送工具调用请求到 Chrome Extension，等待结果
   */
  async sendRequest(tool: string, args: Record<string, any>, timeout = 30000): Promise<any> {
    if (!this._bridgeReady) {
      throw new Error(
        "MCP Bridge 未就绪（端口 9527 被占用）。可能原因：其他 Claude Code 会话已占用。\n" +
        "解决方法：1) 关闭其他 Claude Code 会话 2) kill 旧进程: lsof -i :9527"
      )
    }

    if (!this.extWs || this.extWs.readyState !== WebSocket.OPEN) {
      throw new Error("Chrome Extension 未连接。请确认扩展已安装且 SidePanel 已打开，并点击「连接 MCP」。")
    }

    const id = `req_${++this.msgCounter}`
    const msg: BridgeMessage = { id, tool, args }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`工具调用超时 (${tool}, ${timeout}ms)`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.extWs!.send(JSON.stringify(msg))
    })
  }

  /** Extension 是否已连接 */
  get isConnected(): boolean {
    return this.extWs !== null && this.extWs.readyState === WebSocket.OPEN
  }

  // ========== CC CLI 执行 ==========

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
          result = await this.executeClaudeCLI(
            this.buildSkillPrompt(req.skill!, req.args),
            120_000
          )
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
      // 从活跃列表移除，处理队列中下一个
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
      // 解析失败，返回原始文本作为单个 skill
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

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      const timer = setTimeout(() => {
        proc.kill("SIGTERM")
        reject(new Error(`Claude CLI 执行超时 (${timeout}ms)`))
      }, timeout)

      const ccProc: CCProcess = { process: proc, timer }
      this.activeProcesses.push(ccProc)

      proc.on("close", (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(stderr.trim() || `Claude CLI 退出码: ${code}`))
        }
      })

      proc.on("error", (err) => {
        clearTimeout(timer)
        reject(new Error(`Claude CLI 启动失败: ${err.message}`))
      })
    })
  }

  private sendCCResponse(id: string, result?: any, error?: string) {
    if (!this.extWs || this.extWs.readyState !== WebSocket.OPEN) return
    const msg: CCResponse = { type: "cc_response", id, result, error }
    this.extWs.send(JSON.stringify(msg))
  }

  /** 关闭 Bridge */
  close() {
    // 清理所有活跃的 Claude CLI 进程
    for (const ccProc of this.activeProcesses) {
      clearTimeout(ccProc.timer)
      ccProc.process.kill("SIGTERM")
    }
    this.activeProcesses = []
    this.requestQueue = []

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error("Bridge 已关闭"))
    }
    this.pending.clear()
    this.wss?.close()
  }
}
