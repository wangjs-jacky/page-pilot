import { findMatchingScripts } from "../lib/storage/scripts"

// 安装时打开设置页
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage()
  }
})

// 监听 Tab 更新，检测 URL 匹配
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
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

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_CURRENT_TAB") {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
      sendResponse({ tab: tabs[0] || null })
    })
    return true // 异步响应
  }
})

// 处理来自 Content Script 的脚本执行请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "EXECUTE_IN_MAIN") {
    const tabId = sender.tab?.id
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
    return true
  }
})
