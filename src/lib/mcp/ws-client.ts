/**
 * Chrome Extension WebSocket 客户端
 * 连接到 PagePilot MCP Server 的 Bridge，接收并执行工具调用
 * 支持反向请求：向 Bridge 发送 Claude CLI 执行请求
 */

import type { ClaudeCodeSkill } from "../types"

const WS_URL = "ws://localhost:9527"
const RECONNECT_INTERVAL = 3000

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

interface BridgeMessage {
  id: string
  tool: string
  args: Record<string, any>
}

// 反向请求消息（Extension → Bridge）
interface CCRequestMessage {
  type: "cc_request"
  id: string
  action: "invoke_skill" | "ask_prompt" | "list_skills"
  skill?: string
  args?: Record<string, any>
  prompt?: string
}

// Bridge 响应消息
interface CCResponseMessage {
  type: "cc_response"
  id: string
  result?: any
  error?: string
}

type PendingCCRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let ccRequestCounter = 0
const pendingCCRequests = new Map<string, PendingCCRequest>()

/** 连接到 MCP Bridge */
export function connectMCPBridge() {
  if (ws && ws.readyState === WebSocket.OPEN) return

  try {
    ws = new WebSocket(WS_URL)
  } catch (e) {
    console.log("[MCP Client] WebSocket 创建失败，将在 3 秒后重试")
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    console.log("[MCP Client] 已连接到 MCP Bridge")
    notifyConnectionStatus(true)
  }

  ws.onmessage = async (event) => {
    try {
      const parsed = JSON.parse(event.data)

      // Bridge 返回的 CC 执行结果
      if (parsed.type === "cc_response" && pendingCCRequests.has(parsed.id)) {
        const pending = pendingCCRequests.get(parsed.id)!
        clearTimeout(pending.timer)
        pendingCCRequests.delete(parsed.id)
        if (parsed.error) {
          pending.reject(new Error(parsed.error))
        } else {
          pending.resolve(parsed.result)
        }
        return
      }

      // MCP 工具调用（CC → Extension 方向）
      const msg: BridgeMessage = parsed
      const result = await handleToolCall(msg.tool, msg.args)
      sendResponse(msg.id, result)
    } catch (e: any) {
      console.error("[MCP Client] 处理消息失败:", e)
      const parsed = typeof event.data === "string" ? JSON.parse(event.data) : {}
      sendResponse(parsed.id || "unknown", null, e.message)
    }
  }

  ws.onclose = () => {
    console.log("[MCP Client] 连接断开")
    ws = null
    notifyConnectionStatus(false)
    scheduleReconnect()
  }

  ws.onerror = () => {
    // onclose 会处理重连
  }
}

/** 断开连接 */
export function disconnectMCPBridge() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  notifyConnectionStatus(false)
}

/** 获取连接状态 */
export function isMCPConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectMCPBridge()
  }, RECONNECT_INTERVAL)
}

function sendResponse(id: string, result: any, error?: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ id, result, error }))
}

function notifyConnectionStatus(connected: boolean) {
  try {
    chrome.runtime.sendMessage({
      type: "MCP_STATUS",
      payload: { connected },
    })
  } catch {
    // SidePanel 可能未打开
  }
}

// ========== CC 反向请求（Extension → Bridge → Claude CLI） ==========

function sendCCRequest(action: CCRequestMessage["action"], payload: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket 未连接，请先连接 MCP"))
      return
    }

    const id = `cc_${++ccRequestCounter}`
    const timeout = action === "list_skills" ? 30_000 : 120_000

    const timer = setTimeout(() => {
      pendingCCRequests.delete(id)
      reject(new Error("CC 请求超时"))
    }, timeout)

    pendingCCRequests.set(id, { resolve, reject, timer })

    const msg: CCRequestMessage = { type: "cc_request", id, action, ...payload }
    ws.send(JSON.stringify(msg))
  })
}

/** 列出 CC 可用的 skills */
export async function listSkills(): Promise<ClaudeCodeSkill[]> {
  const result = await sendCCRequest("list_skills")
  return Array.isArray(result) ? result : []
}

/** 调用 CC skill */
export async function invokeSkill(skill: string, args?: Record<string, any>): Promise<string> {
  const result = await sendCCRequest("invoke_skill", { skill, args })
  return result?.output || ""
}

/** 向 CC 发送自由 prompt */
export async function askClaude(prompt: string): Promise<string> {
  const result = await sendCCRequest("ask_prompt", { prompt })
  return result?.output || ""
}

// ========== 工具调用处理（CC → Extension） ==========

async function handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
  switch (tool) {
    case "ping":
      return "pong"

    case "get_url":
      return await handleGetUrl()

    case "get_dom":
      return await handleGetDom(args)

    case "execute_script":
      return await handleExecuteScript(args)

    case "extract_data":
      return await handleExtractData(args)

    case "get_text":
      return await handleGetText(args)

    case "navigate":
      return await handleNavigate(args)

    default:
      throw new Error(`未知工具: ${tool}`)
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error("没有活跃的标签页")
  return tab
}

async function handleGetUrl(): Promise<string> {
  const tab = await getActiveTab()
  return tab.url || ""
}

async function handleGetDom(args: {
  selector?: string
  maxDepth?: number
  maxLength?: number
}): Promise<string> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (selector: string | undefined, maxDepth: number, maxLength: number) => {
      function snapshotNode(el: Element, depth: number): string {
        if (depth <= 0) return ""

        const tag = el.tagName.toLowerCase()
        // 过滤 script, style, noscript
        if (["script", "style", "noscript", "svg", "path"].includes(tag)) return ""

        const attrs: string[] = []
        for (const attr of Array.from(el.attributes)) {
          // 只保留语义化属性
          if (
            ["id", "class", "href", "src", "data-", "alt", "title", "role", "aria-"].some(
              (p) => attr.name.startsWith(p) || attr.name === p.replace("-", "")
            )
          ) {
            const val = attr.value.length > 80 ? attr.value.slice(0, 80) + "..." : attr.value
            attrs.push(`${attr.name}="${val}"`)
          }
        }

        const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : ""
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 100)

        const children = Array.from(el.children)
          .map((child) => snapshotNode(child, depth - 1))
          .filter(Boolean)
          .join("\n")

        let result = `${"  ".repeat(5 - depth)}<${tag}${attrStr}>`
        if (directText) result += directText
        if (children) result += "\n" + children + "\n" + `${"  ".repeat(5 - depth)}`
        result += `</${tag}>`

        return result
      }

      const root = selector ? document.querySelector(selector) : document.body
      if (!root) return "未找到匹配元素"
      const snapshot = snapshotNode(root, maxDepth)
      return snapshot.length > maxLength ? snapshot.slice(0, maxLength) + "\n... (已截断)" : snapshot
    },
    args: [args.selector, args.maxDepth || 5, args.maxLength || 8000],
  })
  return results?.[0]?.result || ""
}

async function handleExecuteScript(args: { code: string }): Promise<any> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (code: string) => {
      return (0, eval)(code)
    },
    args: [args.code],
  })
  return results?.[0]?.result
}

async function handleExtractData(args: {
  containerSelector: string
  itemSelector: string
  fields: Record<string, { selector: string; attribute: string }>
}): Promise<any[]> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (
      containerSelector: string,
      itemSelector: string,
      fields: Record<string, { selector: string; attribute: string }>
    ) => {
      const container = document.querySelector(containerSelector)
      if (!container) return { error: `未找到容器: ${containerSelector}` }

      const items = container.querySelectorAll(itemSelector)
      if (items.length === 0) return { error: `容器内未找到列表项: ${itemSelector}` }

      const data: Record<string, any>[] = []
      items.forEach((item) => {
        const row: Record<string, any> = {}
        for (const [name, config] of Object.entries(fields)) {
          const el = item.querySelector(config.selector)
          if (!el) {
            row[name] = null
            continue
          }
          if (config.attribute === "textContent") {
            row[name] = el.textContent?.trim() || null
          } else if (config.attribute.startsWith("data-")) {
            row[name] = el.getAttribute(config.attribute)
          } else {
            row[name] = (el as any)[config.attribute] || null
          }
        }
        data.push(row)
      })
      return data
    },
    args: [args.containerSelector, args.itemSelector, args.fields],
  })
  return results?.[0]?.result || []
}

async function handleGetText(args: {
  selector?: string
  maxLength?: number
}): Promise<string> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (selector: string | undefined, maxLength: number) => {
      const el = selector ? document.querySelector(selector) : document.body
      if (!el) return "未找到匹配元素"
      const text = (el.textContent || "").replace(/\s+/g, " ").trim()
      return text.length > maxLength ? text.slice(0, maxLength) + "... (已截断)" : text
    },
    args: [args.selector, args.maxLength || 5000],
  })
  return results?.[0]?.result || ""
}

async function handleNavigate(args: { url: string }): Promise<void> {
  const tab = await getActiveTab()
  await chrome.tabs.update(tab.id!, { url: args.url })
  // 等待页面加载
  return new Promise((resolve) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === tab.id && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    // 超时保底
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 10000)
  })
}
