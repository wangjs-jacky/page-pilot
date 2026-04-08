import { describe, expect, it, vi } from "vitest"
import type { PaginationConfig } from "../types"
import { runPaginatedExtraction } from "./runner"

function createPagination(mode: PaginationConfig["mode"]): PaginationConfig {
  return {
    enabled: true,
    mode,
    nextButtonSelector: ".next",
    pageButtonSelector: ".page",
    maxPages: 3,
    waitMs: 10,
  }
}

describe("runPaginatedExtraction", () => {
  it("在首条数据重复时提前停止", async () => {
    const pages = [[{ id: 1 }], [{ id: 1 }], [{ id: 2 }]]
    let index = 0

    const result = await runPaginatedExtraction({
      extractionCode: "code",
      pagination: createPagination("click"),
      ops: {
        extract: vi.fn(async () => pages[index++] ?? []),
        clickNext: vi.fn(async () => true),
        clickNumbered: vi.fn(async () => true),
        scrollToBottom: vi.fn(async () => {}),
        getCurrentUrl: vi.fn(async () => "https://example.com/list?page=1"),
        navigateTo: vi.fn(async () => {}),
        waitForContent: vi.fn(async () => {}),
      },
    })

    expect(result.data).toEqual([{ id: 1 }])
    expect(result.stopReason).toBe("duplicate-page")
  })

  it("numbered 模式应按页码点击", async () => {
    const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]]
    let index = 0
    const clickNumbered = vi.fn(async () => true)

    await runPaginatedExtraction({
      extractionCode: "code",
      pagination: createPagination("numbered"),
      ops: {
        extract: vi.fn(async () => pages[index++] ?? []),
        clickNext: vi.fn(async () => true),
        clickNumbered,
        scrollToBottom: vi.fn(async () => {}),
        getCurrentUrl: vi.fn(async () => "https://example.com/list?page=1"),
        navigateTo: vi.fn(async () => {}),
        waitForContent: vi.fn(async () => {}),
      },
    })

    expect(clickNumbered).toHaveBeenNthCalledWith(1, ".page", 2)
    expect(clickNumbered).toHaveBeenNthCalledWith(2, ".page", 3)
  })

  it("应支持外部停止信号", async () => {
    const pages = [[{ id: 1 }], [{ id: 2 }], [{ id: 3 }]]
    let index = 0
    let shouldContinueCalls = 0

    const result = await runPaginatedExtraction({
      extractionCode: "code",
      pagination: createPagination("click"),
      shouldContinue: () => {
        shouldContinueCalls += 1
        return shouldContinueCalls <= 1
      },
      ops: {
        extract: vi.fn(async () => pages[index++] ?? []),
        clickNext: vi.fn(async () => true),
        clickNumbered: vi.fn(async () => true),
        scrollToBottom: vi.fn(async () => {}),
        getCurrentUrl: vi.fn(async () => "https://example.com/list?page=1"),
        navigateTo: vi.fn(async () => {}),
        waitForContent: vi.fn(async () => {}),
      },
    })

    expect(result.data).toEqual([{ id: 1 }])
    expect(result.stopReason).toBe("stopped")
  })

  it("url 模式应正确递增 page 参数", async () => {
    const pages = [[{ id: 1 }], [{ id: 2 }]]
    let index = 0
    let currentUrl = "https://example.com/list?page=1"
    const navigateTo = vi.fn(async (url: string) => {
      currentUrl = url
    })

    await runPaginatedExtraction({
      extractionCode: "code",
      pagination: {
        ...createPagination("url"),
        maxPages: 2,
      },
      ops: {
        extract: vi.fn(async () => pages[index++] ?? []),
        clickNext: vi.fn(async () => true),
        clickNumbered: vi.fn(async () => true),
        scrollToBottom: vi.fn(async () => {}),
        getCurrentUrl: vi.fn(async () => currentUrl),
        navigateTo,
        waitForContent: vi.fn(async () => {}),
      },
    })

    expect(navigateTo).toHaveBeenCalledWith("https://example.com/list?page=2")
  })
})
