import { findMatchingScripts } from "../lib/storage/scripts"
import {
  connectMCPBridge,
  disconnectMCPBridge,
  isMCPConnected,
  listSkills,
  invokeSkill,
  askClaude,
} from "../lib/mcp/ws-client"
import type { DryRunResult, PaginationConfig } from "../lib/types"
import { createChromePaginationOps } from "../lib/pagination/chrome-ops"
import { runPaginatedExtraction } from "../lib/pagination/runner"

// 安装时打开设置页
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage()
  }
})

// 点击扩展图标打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

// 监听 Tab 更新，检测 URL 匹配
chrome.tabs.onUpdated.addListener(async (changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const matching = await findMatchingScripts(tab.url)
    if (matching.length > 0) {
      try {
        await chrome.runtime.sendMessage({
          type: "URL_MATCHED",
          payload: { scriptIds: matching.map((s) => s.id) },
        })
      } catch {
        // SidePanel 可能未打开，忽略错误
      }
    }
  }
})

// 分页执行状态
let paginatedExecutionRunning = false

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 转发 Content Script 的 ELEMENT_SELECTED 到 SidePanel
  if (message.type === "ELEMENT_SELECTED") {
    chrome.runtime.sendMessage(message).catch(() => {})
    return
  }

  // 获取当前标签页
  if (message.type === "GET_CURRENT_TAB") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
      sendResponse({ tab: tabs[0] || null })
    })
    return true
  }

  // 在 MAIN world 执行脚本（单页）
  if (message.type === "EXECUTE_IN_MAIN") {
    // SidePanel 发送时没有 sender.tab，需要主动查询
    const getTabId = async (): Promise<number | null> => {
      if (sender.tab?.id) return sender.tab.id
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return tabs[0]?.id ?? null
    }

    getTabId().then((tabId) => {
      if (!tabId) {
        sendResponse({ error: "No tab found" })
        return
      }
      chrome.scripting
        .executeScript({
          target: { tabId },
          world: "MAIN",
          func: (code: string) => {
            return (0, eval)(code)
          },
          args: [message.payload.code],
        })
        .then((results) => {
          sendResponse({ result: results?.[0]?.result })
        })
        .catch((error) => {
          sendResponse({ error: error.message })
        })
    })
    return true
  }

  // Dry-Run 执行（执行代码 + 捕获 DOM 快照用于自动修复）
  if (message.type === "DRY_RUN_EXECUTE") {
    const { code, cardSelector, containerSelector } = message.payload

    const getTabId = async (): Promise<number | null> => {
      if (sender.tab?.id) return sender.tab.id
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return tabs[0]?.id ?? null
    }

    getTabId().then(async (tabId) => {
      if (!tabId) {
        sendResponse({ success: false, error: "No tab found", itemCount: 0 } satisfies DryRunResult)
        return
      }

      try {
        // 1. 执行提取代码
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (code: string) => {
            try {
              return (0, eval)(code)
            } catch (e: any) {
              return { __error: e.message }
            }
          },
          args: [code],
        })

        const raw = results?.[0]?.result

        // 检测 eval 级别错误
        if (raw && typeof raw === "object" && raw.__error) {
          sendResponse({
            success: false,
            error: raw.__error,
            itemCount: 0,
          } satisfies DryRunResult)
          return
        }

        const data = Array.isArray(raw) ? raw : raw ? [raw] : []

        // 2. 如果返回空，捕获 DOM 快照供自动修复
        let firstCardHTML: string | undefined
        if (data.length === 0 && cardSelector) {
          const snapshot = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (selector: string) => {
              const el = document.querySelector(selector)
              if (!el) {
                // 尝试找到页面上可能匹配的替代元素
                const tag = selector.split(/[.#[\]>]/).filter(Boolean)[0] || ""
                const alternatives = document.querySelectorAll(tag || "*")
                return {
                  found: false,
                  alternativeCount: Math.min(alternatives.length, 5),
                  firstAltHTML: alternatives[0]?.outerHTML?.slice(0, 500) || null,
                }
              }
              const clone = el.cloneNode(true) as Element
              clone.querySelectorAll("script, style, svg").forEach((n) => n.remove())
              return {
                found: true,
                html: clone.outerHTML.slice(0, 1500),
              }
            },
            args: [cardSelector],
          })
          firstCardHTML = snapshot?.[0]?.result?.html || snapshot?.[0]?.result?.firstAltHTML
        }

        sendResponse({
          success: data.length > 0,
          data,
          itemCount: data.length,
          error: data.length === 0 ? `cardSelector "${cardSelector}" matched 0 elements` : undefined,
          firstCardHTML,
        } satisfies DryRunResult)
      } catch (error: any) {
        sendResponse({
          success: false,
          error: error.message,
          itemCount: 0,
        } satisfies DryRunResult)
      }
    })
    return true
  }

  // 分页执行脚本
  if (message.type === "EXECUTE_PAGINATED") {
    if (paginatedExecutionRunning) {
      sendResponse({ error: "已有分页任务在执行中" })
      return
    }

    const { code, pagination } = message.payload as {
      code: string
      pagination: PaginationConfig
    }

    // 获取目标标签页
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        sendResponse({ error: "No tab found" })
        return
      }

      const tabId = tab.id
      paginatedExecutionRunning = true
      sendResponse({ status: "started" })

      try {
        const result = await runPaginatedExtraction({
          extractionCode: code,
          pagination,
          ops: createChromePaginationOps(tabId),
          shouldContinue: () => paginatedExecutionRunning,
          onProgress: async (progress) => {
            await chrome.runtime.sendMessage({
              type: "PAGINATED_PROGRESS",
              payload: { ...progress, done: false },
            }).catch(() => {})
          },
        })

        await chrome.runtime.sendMessage({
          type: "SCRIPT_RESULT",
          payload: { data: result.data },
        }).catch(() => {})

        await chrome.runtime.sendMessage({
          type: "PAGINATED_PROGRESS",
          payload: {
            page: result.pagesVisited,
            maxPages: pagination.maxPages,
            itemsSoFar: result.data.length,
            done: true,
            stopReason: result.stopReason,
          },
        }).catch(() => {})
      } catch (error: any) {
        chrome.runtime.sendMessage({
          type: "PAGINATED_PROGRESS",
          payload: { error: error.message, done: true },
        }).catch(() => {})
      } finally {
        paginatedExecutionRunning = false
      }
    })
    return true
  }

  // 停止分页执行
  if (message.type === "PAGINATION_STOP") {
    paginatedExecutionRunning = false
    sendResponse({ status: "stopped" })
    return
  }

  // MCP 连接控制
  if (message.type === "MCP_CONNECT") {
    connectMCPBridge()
    sendResponse({ status: "connecting" })
    return
  }

  if (message.type === "MCP_DISCONNECT") {
    disconnectMCPBridge()
    sendResponse({ status: "disconnected" })
    return
  }

  if (message.type === "MCP_STATUS") {
    sendResponse({ connected: isMCPConnected() })
    return
  }

  if (message.type === "MCP_AUTO_CONNECT") {
    // 仅在未连接时尝试自动连接（Bridge 运行则连，否则静默跳过）
    if (!isMCPConnected()) {
      connectMCPBridge({ autoConnect: true })
    }
    sendResponse({ connected: isMCPConnected() })
    return
  }

  // === CC 请求（SidePanel → Background → WebSocket → Bridge → Claude CLI） ===

  if (message.type === "CC_LIST_SKILLS") {
    listSkills()
      .then((skills) => sendResponse({ skills }))
      .catch((e: any) => sendResponse({ error: e.message }))
    return true
  }

  if (message.type === "CC_INVOKE_SKILL") {
    invokeSkill(message.payload.skill, message.payload.args)
      .then((output) => sendResponse({ output }))
      .catch((e: any) => sendResponse({ error: e.message }))
    return true
  }

  if (message.type === "CC_ASK_PROMPT") {
    askClaude(message.payload.prompt)
      .then((output) => sendResponse({ output }))
      .catch((e: any) => sendResponse({ error: e.message }))
    return true
  }
})
