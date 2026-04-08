import type { PaginationRuntimeOps } from "./runner"

function waitForTabComplete(tabId: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener)
    }

    const done = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === "complete") {
        done()
      }
    }

    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(done, timeoutMs)
  })
}

export function createChromePaginationOps(tabId: number): PaginationRuntimeOps {
  return {
    extract: async (code: string) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (executionCode: string) => {
          try {
            return (0, eval)(executionCode)
          } catch {
            return []
          }
        },
        args: [code],
      })
      return results?.[0]?.result || []
    },

    clickNext: async (selector: string) => {
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (nextSelector: string) => {
          const btn = document.querySelector(nextSelector) as HTMLElement | null
          if (btn && !btn.disabled) {
            btn.click()
            return true
          }
          return false
        },
        args: [selector],
      })
      return clickResult?.[0]?.result === true
    },

    clickNumbered: async (selector: string, targetPage: number) => {
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (pageSelector: string, target: number) => {
          const buttons = document.querySelectorAll(pageSelector)
          for (const btn of buttons) {
            const num = Number.parseInt(btn.textContent?.trim() || "", 10)
            if (num === target && !(btn as HTMLElement).disabled) {
              ;(btn as HTMLElement).click()
              return true
            }
          }
          return false
        },
        args: [selector, targetPage],
      })
      return clickResult?.[0]?.result === true
    },

    scrollToBottom: async () => {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          window.scrollTo(0, document.body.scrollHeight)
        },
      })
    },

    getCurrentUrl: async () => {
      const urlResult = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => window.location.href,
      })
      return urlResult?.[0]?.result || ""
    },

    navigateTo: async (url: string) => {
      await chrome.tabs.update(tabId, { url })
      await waitForTabComplete(tabId)
    },

    waitForContent: async (waitMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    },
  }
}
