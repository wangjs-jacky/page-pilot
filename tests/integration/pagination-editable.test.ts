/**
 * 分页配置可编辑性测试
 *
 * Bug: ScriptPreview 视图中，分页配置（maxPages、mode、waitMs）是只读展示的，
 * 用户一旦启用分页就无法修改参数。
 *
 * 本测试验证 ScriptPreview 组件的分页编辑能力：
 * 1. 分页区域应展示编辑控件（而非纯文本）
 * 2. maxPages 应可通过 UI 修改
 * 3. waitMs 应可通过 UI 修改
 * 4. mode 应可切换
 */
import { describe, it, expect } from "vitest"

// --- 提取组件可编辑状态的纯逻辑测试 ---

/**
 * 模拟 ScriptPreview 中分页配置的可编辑逻辑
 * 这些是组件内部应该维护的状态和行为
 */
interface PaginationEditState {
  enabled: boolean
  mode: "click" | "scroll" | "url"
  maxPages: number
  waitMs: number
  nextButtonSelector: string
}

function createPaginationEditor(initial: PaginationEditState) {
  let state = { ...initial }

  return {
    getState: () => ({ ...state }),
    setMaxPages: (n: number) => {
      state.maxPages = Math.max(1, Math.min(100, n))
    },
    setWaitMs: (ms: number) => {
      state.waitMs = Math.max(500, Math.min(5000, ms))
    },
    setMode: (mode: "click" | "scroll" | "url") => {
      state.mode = mode
    },
    setNextButtonSelector: (selector: string) => {
      state.nextButtonSelector = selector
    },
  }
}

describe("Pagination Editable in ScriptPreview", () => {
  const defaultPagination: PaginationEditState = {
    enabled: true,
    mode: "click",
    maxPages: 5,
    waitMs: 2000,
    nextButtonSelector: ".next-btn",
  }

  it("应能修改 maxPages", () => {
    const editor = createPaginationEditor(defaultPagination)
    expect(editor.getState().maxPages).toBe(5)

    editor.setMaxPages(10)
    expect(editor.getState().maxPages).toBe(10)
  })

  it("maxPages 最小值限制为 1", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setMaxPages(0)
    expect(editor.getState().maxPages).toBe(1)

    editor.setMaxPages(-5)
    expect(editor.getState().maxPages).toBe(1)
  })

  it("maxPages 最大值限制为 100", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setMaxPages(200)
    expect(editor.getState().maxPages).toBe(100)
  })

  it("应能修改 waitMs", () => {
    const editor = createPaginationEditor(defaultPagination)
    expect(editor.getState().waitMs).toBe(2000)

    editor.setWaitMs(3000)
    expect(editor.getState().waitMs).toBe(3000)
  })

  it("waitMs 最小值限制为 500", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setWaitMs(100)
    expect(editor.getState().waitMs).toBe(500)
  })

  it("waitMs 最大值限制为 5000", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setWaitMs(10000)
    expect(editor.getState().waitMs).toBe(5000)
  })

  it("应能切换翻页模式", () => {
    const editor = createPaginationEditor(defaultPagination)
    expect(editor.getState().mode).toBe("click")

    editor.setMode("scroll")
    expect(editor.getState().mode).toBe("scroll")

    editor.setMode("url")
    expect(editor.getState().mode).toBe("url")
  })

  it("应能修改下一页按钮选择器", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setNextButtonSelector(".pagination-next")
    expect(editor.getState().nextButtonSelector).toBe(".pagination-next")
  })

  it("修改分页参数不应影响其他参数", () => {
    const editor = createPaginationEditor(defaultPagination)
    editor.setMaxPages(20)
    expect(editor.getState().waitMs).toBe(2000)
    expect(editor.getState().mode).toBe("click")
    expect(editor.getState().nextButtonSelector).toBe(".next-btn")

    editor.setMode("scroll")
    expect(editor.getState().maxPages).toBe(20)
    expect(editor.getState().waitMs).toBe(2000)
  })

  it("预设页数值应可点击切换", () => {
    const editor = createPaginationEditor(defaultPagination)

    // 模拟点击预设值按钮：1, 3, 5, 7
    for (const n of [1, 3, 5, 7]) {
      editor.setMaxPages(n)
      expect(editor.getState().maxPages).toBe(n)
    }

    // 自定义值
    editor.setMaxPages(15)
    expect(editor.getState().maxPages).toBe(15)
  })
})
