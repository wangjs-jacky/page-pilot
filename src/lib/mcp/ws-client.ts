/**
 * Chrome Extension WebSocket 客户端
 * 连接到 PagePilot MCP Server 的 Bridge，接收并执行工具调用
 * 支持反向请求：向 Bridge 发送 Claude CLI 执行请求
 */

import type { ClaudeCodeSkill, ExtractionScript, PaginationConfig } from "../types"
import { createChromePaginationOps } from "../pagination/chrome-ops"
import { runPaginatedExtraction } from "../pagination/runner"

const WS_URL = "ws://localhost:9527"
const RECONNECT_INTERVAL = 3000

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let allowReconnect = true

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

function rejectPendingCCRequests(error: Error) {
  for (const [, pending] of pendingCCRequests) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  pendingCCRequests.clear()
}

/** 连接到 MCP Bridge */
export function connectMCPBridge(options?: { autoConnect?: boolean }) {
  // autoConnect 模式：初始失败不重试，成功后启用重连
  allowReconnect = !options?.autoConnect

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  try {
    ws = new WebSocket(WS_URL)
  } catch (e) {
    if (!options?.autoConnect) {
      console.log("[MCP Client] WebSocket 创建失败，将在 3 秒后重试")
    }
    if (allowReconnect) scheduleReconnect()
    return
  }

  ws.onopen = () => {
    // 连接成功后启用重连（包括 autoConnect 模式）
    allowReconnect = true
    console.log("[MCP Client] 已连接到 MCP Bridge")
    // 向 Bridge Server 注册为 Extension 角色
    ws!.send(JSON.stringify({ type: "register", role: "extension" }))
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
      let messageId = "unknown"
      if (typeof event.data === "string") {
        try {
          messageId = JSON.parse(event.data)?.id || "unknown"
        } catch {
          // 忽略 JSON 解析失败
        }
      }
      sendResponse(messageId, null, e.message)
    }
  }

  ws.onclose = () => {
    console.log("[MCP Client] 连接断开")
    ws = null
    rejectPendingCCRequests(new Error("WebSocket 连接已断开"))
    notifyConnectionStatus(false)
    if (allowReconnect) {
      scheduleReconnect()
    }
  }

  ws.onerror = () => {
    // onclose 会处理重连
  }
}

/** 断开连接 */
export function disconnectMCPBridge() {
  allowReconnect = false

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  rejectPendingCCRequests(new Error("WebSocket 已断开"))

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

    case "script_list":
      return await handleScriptList()

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

    case "script_save":
      return await handleScriptSave(args as any)

    case "script_execute":
      return await handleScriptExecute(args as any)

    case "execute_paginated":
      return await handleExecutePaginated(args as any)

    case "script_delete":
      return await handleScriptDelete(args as any)

    case "pick_element":
      return await handlePickElement(args as any)

    default:
      throw new Error(`未知工具: ${tool}`)
  }
}

async function handleScriptList(): Promise<Array<{ id: string; name: string; urlPatterns: string[]; cardSelector?: string; containerSelector?: string; fields: Array<{ name: string; selector: string; attribute: string }>; lastExecutedAt?: number }>> {
  const SCRIPTS_KEY = "pagepilot_scripts"
  const result = await chrome.storage.local.get(SCRIPTS_KEY)
  const scripts: ExtractionScript[] = result[SCRIPTS_KEY] || []
  return scripts.map((s) => ({
    id: s.id,
    name: s.name,
    urlPatterns: s.urlPatterns,
    cardSelector: s.cardSelector,
    containerSelector: s.containerSelector,
    fields: s.fields,
    lastExecutedAt: s.lastExecutedAt,
  }))
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
    args: [args.selector ?? null, args.maxDepth ?? 5, args.maxLength ?? 8000],
  })
  return results?.[0]?.result || ""
}

async function handleExecuteScript(args: { code: string }): Promise<any> {
  const tab = await getActiveTab()
  // 用 Function 构造器支持 return 语句，间接 eval 不支持顶层 return
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (code: string) => {
      try {
        return new Function(code)()
      } catch (e: any) {
        return { error: e.message }
      }
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
    args: [args.selector ?? null, args.maxLength ?? 5000],
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

// ========== 脚本管理工具（MCP → Extension） ==========

async function handleScriptDelete(args: {
  scriptId?: string
  scriptName?: string
}): Promise<{ deleted: Array<{ id: string; name: string }> }> {
  const SCRIPTS_KEY = "pagepilot_scripts"
  const result = await chrome.storage.local.get(SCRIPTS_KEY)
  const scripts: ExtractionScript[] = result[SCRIPTS_KEY] || []

  let toDelete: ExtractionScript[]

  if (args.scriptId) {
    toDelete = scripts.filter((s) => s.id === args.scriptId)
  } else if (args.scriptName) {
    // 模糊匹配：先精确匹配，再 includes 匹配
    toDelete = scripts.filter((s) => s.name === args.scriptName)
    if (toDelete.length === 0) {
      toDelete = scripts.filter((s) =>
        s.name.toLowerCase().includes(args.scriptName!.toLowerCase())
      )
    }
  } else {
    return { deleted: [] }
  }

  const deleteIds = new Set(toDelete.map((s) => s.id))
  const remaining = scripts.filter((s) => !deleteIds.has(s.id))
  await chrome.storage.local.set({ [SCRIPTS_KEY]: remaining })

  return {
    deleted: toDelete.map((s) => ({ id: s.id, name: s.name })),
  }
}

async function handleScriptSave(args: {
  scriptId?: string
  name: string
  urlPatterns: string[]
  code: string
  fields: Array<{ name: string; selector: string; attribute: string }>
  cardSelector?: string
  containerSelector?: string
  pagination?: {
    enabled?: boolean
    mode: "click" | "numbered" | "scroll" | "url"
    nextButtonSelector?: string
    pageButtonSelector?: string
    maxPages?: number
    waitMs?: number
  }
}): Promise<{ id: string; name: string; action: string }> {
  const SCRIPTS_KEY = "pagepilot_scripts"
  const result = await chrome.storage.local.get(SCRIPTS_KEY)
  const scripts: ExtractionScript[] = result[SCRIPTS_KEY] || []

  const now = Date.now()

  if (args.scriptId) {
    // 更新已有脚本
    const idx = scripts.findIndex((s) => s.id === args.scriptId)
    if (idx >= 0) {
      scripts[idx] = {
        ...scripts[idx],
        name: args.name,
        urlPatterns: args.urlPatterns,
        code: args.code,
        fields: args.fields,
        cardSelector: args.cardSelector,
        containerSelector: args.containerSelector,
        pagination: args.pagination
          ? ({ enabled: true, ...args.pagination } as PaginationConfig)
          : undefined,
      }
      await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts })
      return { id: scripts[idx].id, name: args.name, action: "updated" }
    }
  }

  // 创建新脚本
  const newScript: ExtractionScript = {
    id: crypto.randomUUID(),
    name: args.name,
    urlPatterns: args.urlPatterns,
    code: args.code,
    fields: args.fields,
    cardSelector: args.cardSelector,
    containerSelector: args.containerSelector,
    pagination: args.pagination
      ? ({ enabled: true, ...args.pagination } as PaginationConfig)
      : undefined,
    createdAt: now,
  }
  scripts.push(newScript)
  await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts })
  return { id: newScript.id, name: args.name, action: "created" }
}

async function handleScriptExecute(args: {
  scriptId?: string
  scriptName?: string
}): Promise<any> {
  const SCRIPTS_KEY = "pagepilot_scripts"
  const result = await chrome.storage.local.get(SCRIPTS_KEY)
  const scripts: ExtractionScript[] = result[SCRIPTS_KEY] || []

  let script: ExtractionScript | undefined

  if (args.scriptId) {
    script = scripts.find((s) => s.id === args.scriptId)
  } else if (args.scriptName) {
    // 模糊匹配：先精确匹配，再 includes 匹配
    script = scripts.find((s) => s.name === args.scriptName)
    if (!script) {
      script = scripts.find((s) =>
        s.name.toLowerCase().includes(args.scriptName!.toLowerCase())
      )
    }
  }

  if (!script) {
    throw new Error(
      `未找到脚本: ${args.scriptId || args.scriptName}。可用脚本: ${scripts.map((s) => s.name).join(", ")}`
    )
  }

  const tab = await getActiveTab()

  // 更新最后执行时间
  const idx = scripts.findIndex((s) => s.id === script!.id)
  if (idx >= 0) {
    scripts[idx].lastExecutedAt = Date.now()
    await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts })
  }

  // 如果有分页配置，执行分页提取
  if (script.pagination?.enabled) {
    return await executePaginatedFromMCP(
      tab.id!,
      script.code,
      script.pagination
    )
  }

  // 单页执行脚本
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (code: string) => {
      try {
        return (0, eval)(code)
      } catch (e: any) {
        return { error: e.message }
      }
    },
    args: [script.code],
  })

  return results?.[0]?.result
}

async function handleExecutePaginated(args: {
  code: string
  pagination: {
    mode: "click" | "numbered" | "scroll" | "url"
    nextButtonSelector?: string
    pageButtonSelector?: string
    maxPages?: number
    waitMs?: number
  }
}): Promise<any> {
  const tab = await getActiveTab()

  const paginationConfig: PaginationConfig = {
    enabled: true,
    mode: args.pagination.mode,
    nextButtonSelector: args.pagination.nextButtonSelector || "",
    pageButtonSelector: args.pagination.pageButtonSelector,
    maxPages: args.pagination.maxPages || 5,
    waitMs: args.pagination.waitMs || 2000,
  }

  return await executePaginatedFromMCP(tab.id!, args.code, paginationConfig)
}

/**
 * 分页提取核心逻辑（MCP 版本）— 结果直接回传 Bridge，不推 SidePanel
 */
async function executePaginatedFromMCP(
  tabId: number,
  extractionCode: string,
  pagination: PaginationConfig
): Promise<{ totalItems: number; pages: number; data: Record<string, any>[] }> {
  const result = await runPaginatedExtraction({
    extractionCode,
    pagination,
    ops: createChromePaginationOps(tabId),
  })

  return {
    totalItems: result.data.length,
    pages: result.pagesVisited,
    data: result.data,
  }
}

// ========== 元素选择工具（MCP → Extension → 用户交互 → 回传） ==========

async function handlePickElement(args: { prompt?: string }): Promise<any> {
  const tab = await getActiveTab()
  if (!tab?.id) throw new Error("没有活跃的标签页")

  console.log("[MCP pick_element] 在 tab", tab.id, tab.url, "启动选择器")

  // MCP 模式下统一使用 executeScript 路径，绕过 Content Script 消息路由的不可靠性
  // （Content Script 在扩展重载后监听器会失效，而 sendMessage 不报错）
  console.log("[MCP pick_element] 使用 executeScript 路径")

  // 用 executeScript 在 MAIN world 注入选择器逻辑
  // 用户点击后将结果存到 DOM 中，Background 通过轮询读取

  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (promptText: string | null) => {
      // 清理之前的选择器
      const prevResult = document.getElementById("__pagepilot_pick_result")
      if (prevResult) prevResult.remove()

      // 注入样式
      let style = document.getElementById("pagepilot-highlight-style") as HTMLStyleElement
      if (!style) {
        style = document.createElement("style")
        style.id = "pagepilot-highlight-style"
        document.head.appendChild(style)
      }
      style.textContent = `.pagepilot-highlight { outline: 2px solid #00d4ff !important; outline-offset: 2px !important; background-color: rgba(0, 212, 255, 0.1) !important; cursor: crosshair !important; }`

      // 提示浮层
      let banner = document.getElementById("__pagepilot_pick_banner") as HTMLDivElement
      if (banner) banner.remove()
      banner = document.createElement("div")
      banner.id = "__pagepilot_pick_banner"
      banner.textContent = promptText || "请点击选中一个元素"
      Object.assign(banner.style, {
        position: "fixed", top: "0", left: "0", right: "0", zIndex: "2147483647",
        padding: "8px 16px", background: "#00d4ff", color: "#000", fontWeight: "bold",
        fontSize: "14px", textAlign: "center", fontFamily: "system-ui, sans-serif",
      })
      document.body.appendChild(banner)

      let hoveredEl: Element | null = null
      const onOver = (e: MouseEvent) => {
        const t = e.target as Element
        if (t === document.body || t === document.documentElement || t.id?.startsWith("__pagepilot")) return
        if (hoveredEl) hoveredEl.classList.remove("pagepilot-highlight")
        hoveredEl = t
        t.classList.add("pagepilot-highlight")
      }
      const onClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const t = e.target as Element

        // 先移除高亮类再计算选择器和序列化
        t.classList.remove("pagepilot-highlight")

        // 计算选择器
        const calcSelector = (el: Element): string => {
          if (el.id && !el.id.startsWith("__pagepilot")) return `#${CSS.escape(el.id)}`
          const tag = el.tagName.toLowerCase()
          const classes = Array.from(el.classList).filter(
            (c) => c !== "pagepilot-highlight" && !c.startsWith("css-") && !c.startsWith("sc-") && !c.startsWith("_") && !c.startsWith("data-v-")
          )
          if (classes.length > 0) {
            const sel = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`
            if (el.parentElement && el.parentElement.querySelectorAll(sel).length === 1) return sel
          }
          const parts: string[] = []
          let cur: Element | null = el
          while (cur && cur !== document.body && cur !== document.documentElement) {
            const t2 = cur.tagName.toLowerCase()
            const idx = Array.from(cur.parentElement!.children).indexOf(cur) + 1
            parts.unshift(`${t2}:nth-child(${idx})`)
            cur = cur.parentElement
          }
          return parts.join(" > ")
        }

        const selector = calcSelector(t)
        const cleanHtml = ((): string => {
          const c = t.cloneNode(true) as Element
          c.querySelectorAll("script, style, svg").forEach((n) => n.remove())
          let h = c.outerHTML
          if (h.length > 4000) h = h.slice(0, 4000) + "\n<!-- ... 截断 ... -->"
          return h
        })()

        // 写入 DOM 作为结果传递通道
        const resultEl = document.createElement("div")
        resultEl.id = "__pagepilot_pick_result"
        resultEl.style.display = "none"
        resultEl.textContent = JSON.stringify({
          selector,
          tagName: t.tagName.toLowerCase(),
          text: t.textContent?.trim().slice(0, 50) || "",
          outerHTML: cleanHtml,
        })
        document.body.appendChild(resultEl)

        // 清理
        if (hoveredEl) hoveredEl.classList.remove("pagepilot-highlight")
        document.removeEventListener("mouseover", onOver, true)
        document.removeEventListener("click", onClick, true)
        banner.remove()
      }
      document.addEventListener("mouseover", onOver, true)
      document.addEventListener("click", onClick, true)
    },
    args: [args.prompt ?? null],
  })

  // 轮询 DOM 中的结果，最多 60s
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const poll = async () => {
      if (Date.now() - startTime > 60_000) {
        // 清理
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: "MAIN",
          func: () => {
            document.getElementById("__pagepilot_pick_banner")?.remove()
            document.getElementById("__pagepilot_pick_result")?.remove()
          },
          args: [],
        })
        reject(new Error("元素选择超时（60s）"))
        return
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          world: "MAIN",
          func: () => {
            const el = document.getElementById("__pagepilot_pick_result")
            return el ? el.textContent : null
          },
          args: [],
        })
        const data = results?.[0]?.result
        if (data) {
          // 清理结果标记
          await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            world: "MAIN",
            func: () => { document.getElementById("__pagepilot_pick_result")?.remove() },
            args: [],
          })
          resolve(JSON.parse(data))
          return
        }
      } catch {
        // 轮询失败，继续
      }
      setTimeout(poll, 500)
    }
    poll()
  })
}
