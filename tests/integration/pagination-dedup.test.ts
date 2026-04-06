/**
 * 分页去重核心逻辑的单元测试
 * 提取自 background/index.ts 中的去重算法
 */
import { describe, it, expect } from "vitest"

/**
 * 模拟分页提取的去重核心逻辑
 * 比较两次提取结果的第一条数据，判断是否重复
 */
function shouldStopPagination(
  previousResults: Record<string, any>[],
  currentResults: Record<string, any>[],
  running: boolean
): { shouldStop: boolean; reason: string } {
  if (!running) {
    return { shouldStop: true, reason: "running 标志被清除" }
  }

  if (currentResults.length === 0) {
    return { shouldStop: true, reason: "当前页无数据" }
  }

  // 去重：比较第一条数据的签名
  const previousSignature = JSON.stringify(previousResults[0] || {})
  const currentSignature = JSON.stringify(currentResults[0] || {})

  if (previousSignature === currentSignature && previousResults.length > 0) {
    return { shouldStop: true, reason: "页面数据重复（分页未生效）" }
  }

  return { shouldStop: false, reason: "继续" }
}

describe("Pagination Deduplication", () => {
  describe("shouldStopPagination", () => {
    it("页面数据重复时停止", () => {
      const page1 = [{ id: 1, name: "A" }, { id: 2, name: "B" }]
      const page2 = [{ id: 1, name: "A" }, { id: 2, name: "B" }] // 完全相同

      const result = shouldStopPagination(page1, page2, true)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain("重复")
    })

    it("第一条数据不同时继续", () => {
      const page1 = [{ id: 1, name: "A" }, { id: 2, name: "B" }]
      const page2 = [{ id: 3, name: "C" }, { id: 4, name: "D" }]
      const result = shouldStopPagination(page1, page2, true)
      expect(result.shouldStop).toBe(false)
    })

    it("当前页为空时停止", () => {
      const page1 = [{ id: 1, name: "A" }]
      const page2: Record<string, any>[] = []
      const result = shouldStopPagination(page1, page2, true)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain("无数据")
    })

    it("running 标志清除时停止", () => {
      const page1 = [{ id: 1, name: "A" }]
      const page2 = [{ id: 2, name: "B" }]
      const result = shouldStopPagination(page1, page2, false)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain("running")
    })

    it("首次页面不应该停止（无前序数据）", () => {
      const page1: Record<string, any>[] = []
      const page2 = [{ id: 1, name: "A" }]
      // 首次提取时 previousResults 为空
      const result = shouldStopPagination(page1, page2, true)
      expect(result.shouldStop).toBe(false)
    })

    it("单条数据页面的去重", () => {
      const page1 = [{ id: 1, name: "唯一" }]
      const page2 = [{ id: 1, name: "唯一" }] // 重复
      const result = shouldStopPagination(page1, page2, true)
      expect(result.shouldStop).toBe(true)
    })

    it("多页汇总不重复时数据完整", () => {
      const pages = [
        [{ id: 1 }, { id: 2 }, { id: 3 }],
        [{ id: 4 }, { id: 5 }, { id: 6 }],
        [{ id: 7 }, { id: 8 }, { id: 9 }],
      ]

      const allResults: Record<string, any>[] = []
      for (const page of pages) {
        const result = shouldStopPagination(
          allResults.length > 0 ? [allResults[0]] : [],
          page,
          true
        )
        expect(result.shouldStop).toBe(false)
        allResults.push(...page)
      }

      expect(allResults).toHaveLength(9)
    })

    it("第二轮重复后停止", () => {
      const pages = [
        [{ id: 1 }, { id: 2 }],
        [{ id: 1 }, { id: 2 }], // 重复，应该在这里停止
      ]

      const allResults: Record<string, any>[] = []
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        const result = shouldStopPagination(
          allResults.length > 0 ? [allResults[0]] : [],
          page,
          true
        )
        if (result.shouldStop && i > 0) {
          break
        }
        allResults.push(...page)
      }

      // 只收集了第一页
      expect(allResults).toHaveLength(2)
    })
  })

  describe("多页汇总模拟", () => {
    it("3 页 × 10 条 = 30 条数据", () => {
      const generatePage = (startId: number) =>
        Array.from({ length: 10 }, (_, i) => ({
          id: startId + i,
          title: `Item ${startId + i}`,
        }))

      const allResults: Record<string, any>[] = []
      const maxPages = 3

      for (let page = 1; page <= maxPages; page++) {
        const pageData = generatePage((page - 1) * 10 + 1)
        const result = shouldStopPagination(
          allResults.length > 0 ? [allResults[0]] : [],
          pageData,
          true
        )
        if (result.shouldStop) break
        allResults.push(...pageData)
      }

      expect(allResults).toHaveLength(30)
    })

    it("提前检测到重复并停止", () => {
      const page1 = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))
      const page2 = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })) // 完全相同 = 翻页失败

      const allResults: Record<string, any>[] = [...page1]

      const result = shouldStopPagination([allResults[0]], page2, true)
      expect(result.shouldStop).toBe(true)
      expect(allResults).toHaveLength(10) // 只有第一页数据
    })
  })
})
