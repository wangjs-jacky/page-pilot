import { findMatchingScripts } from "../lib/storage/scripts"
import {
  connectMCPBridge,
  disconnectMCPBridge,
  isMCPConnected,
  listSkills,
  invokeSkill,
  askClaude,
} from "../lib/mcp/ws-client"
import type { PaginationConfig } from "../lib/types"

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
        await executePaginatedExtraction(tabId, code, pagination)
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

// 分页提取核心逻辑
async function executePaginatedExtraction(
  tabId: number,
  extractionCode: string,
  pagination: PaginationConfig
) {
  const allResults: Record<string, any>[] = []
  let previousFirstItemSignature = ""

  for (let page = 1; page <= pagination.maxPages; page++) {
    if (!paginatedExecutionRunning) break

    // 执行提取
    const extractResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (code: string) => {
        try {
          return (0, eval)(code)
        } catch {
          return []
        }
      },
      args: [extractionCode],
    })

    const pageData = extractResults?.[0]?.result || []
    const items = Array.isArray(pageData) ? pageData : [pageData]

    // 去重检查：如果第一个元素和上次一样，说明翻页没生效
    if (items.length > 0 && page > 1) {
      const firstItem = items[0]
      const signature = JSON.stringify(firstItem)
      if (signature === previousFirstItemSignature) {
        // 翻页未生效，停止
        break
      }
    }

    if (items.length > 0) {
      previousFirstItemSignature = JSON.stringify(items[0])
    }

    allResults.push(...items)

    // 发送进度
    await chrome.runtime.sendMessage({
      type: "PAGINATED_PROGRESS",
      payload: { page, maxPages: pagination.maxPages, itemsSoFar: allResults.length, done: false },
    }).catch(() => {})

    // 如果不是最后一页，执行翻页
    if (page < pagination.maxPages && items.length > 0) {
      let pageChanged = false

      if (pagination.mode === "click") {
        // 点击下一页按钮 — 检查选择器是否有效
        if (!pagination.nextButtonSelector?.trim()) {
          break
        }
        const clickResult = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (selector: string) => {
            const btn = document.querySelector(selector) as HTMLElement | null
            if (btn && !btn.disabled) {
              btn.click()
              return true
            }
            return false
          },
          args: [pagination.nextButtonSelector],
        })
        pageChanged = clickResult?.[0]?.result === true
      } else if (pagination.mode === "scroll") {
        // 滚动到底部
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            window.scrollTo(0, document.body.scrollHeight)
          },
        })
        pageChanged = true
      } else if (pagination.mode === "url") {
        // URL 翻页 — 提取当前页码并递增
        const urlResult = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => window.location.href,
        })
        const currentUrl = urlResult?.[0]?.result || ""
        const pageMatch = currentUrl.match(/page=(\d+)/)
        if (pageMatch) {
          const currentPage = parseInt(pageMatch[1])
          const nextUrl = currentUrl.replace(`page=${currentPage}`, `page=${currentPage + 1}`)
          await chrome.tabs.update(tabId, { url: nextUrl })
          // 等待页面加载
          await new Promise<void>((resolve) => {
            const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (updatedTabId === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
              }
            }
            chrome.tabs.onUpdated.addListener(listener)
            // 超时保护
            setTimeout(resolve, 10000)
          })
          pageChanged = true
        }
      }

      if (!pageChanged && pagination.mode === "click") {
        // 点击翻页失败（没有下一页按钮），停止
        break
      }

      // 等待新内容加载
      await new Promise((resolve) => setTimeout(resolve, pagination.waitMs))
    }
  }

  // 发送最终结果
  await chrome.runtime.sendMessage({
    type: "SCRIPT_RESULT",
    payload: { data: allResults },
  }).catch(() => {})

  // 发送完成进度
  await chrome.runtime.sendMessage({
    type: "PAGINATED_PROGRESS",
    payload: { page: pagination.maxPages, maxPages: pagination.maxPages, itemsSoFar: allResults.length, done: true },
  }).catch(() => {})
}
