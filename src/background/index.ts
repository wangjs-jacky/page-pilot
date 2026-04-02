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
