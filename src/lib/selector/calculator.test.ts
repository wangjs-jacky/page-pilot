/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  calculateSelector,
  getElementPreview,
  getDOMContext,
} from "./calculator"

// Polyfill CSS.escape for jsdom
if (typeof CSS === "undefined" || !CSS.escape) {
  global.CSS = {
    escape: (value: string) => {
      // Simplified CSS.escape polyfill
      return value.replace(/([^\w-])/g, "\\$1")
    },
  } as any
}

describe("Selector Calculator", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  describe("calculateSelector", () => {
    it("应该优先使用 ID 选择器", () => {
      container.innerHTML = `
        <div id="unique-id" class="test-class">Content</div>
      `

      const element = container.querySelector("#unique-id")!
      const selector = calculateSelector(element)

      expect(selector).toBe("#unique-id")
    })

    it("应该使用 class 组合（当在父元素中唯一时）", () => {
      container.innerHTML = `
        <div>
          <span class="unique-class">Item 1</span>
          <span class="other-class">Item 2</span>
        </div>
      `

      const element = container.querySelector(".unique-class")!
      const selector = calculateSelector(element)

      expect(selector).toBe("span.unique-class")
    })

    it("应该追溯到有 ID 的祖先", () => {
      container.innerHTML = `
        <div id="ancestor-container">
          <div>
            <span class="item">Content 1</span>
            <span class="item">Content 2</span>
          </div>
        </div>
      `

      const element = container.querySelector(".item")!
      const selector = calculateSelector(element)

      // 应该包含祖先 ID (因为 class 不是唯一的)
      expect(selector).toContain("#ancestor-container")
    })

    it("应该使用 nth-child 路径（无 ID 或唯一 class 时）", () => {
      container.innerHTML = `
        <div>
          <div>
            <span>Item 1</span>
            <span>Item 2</span>
            <span>Item 3</span>
          </div>
        </div>
      `

      const element = container.querySelectorAll("span")[1]
      const selector = calculateSelector(element)

      expect(selector).toContain("nth-child")
    })

    it("应该转义特殊字符", () => {
      container.innerHTML = `
        <div id="test.id.with.dots">Content</div>
      `

      const element = container.querySelector("#test\\.id\\.with\\.dots")!
      const selector = calculateSelector(element)

      expect(selector).toContain("test\\.id\\.with\\.dots")
    })

    it("应该过滤掉自动生成的 class", () => {
      container.innerHTML = `
        <div class="css-abc123 sc-def456 _private">Content</div>
      `

      const element = container.querySelector("div")!
      const selector = calculateSelector(element)

      // 应该不包含 css-, sc-, _ 开头的 class
      expect(selector).not.toContain("css-")
      expect(selector).not.toContain("sc-")
      expect(selector).not.toContain("_private")
    })
  })

  describe("getElementPreview", () => {
    it("应该返回元素的文本内容（前 50 个字符）", () => {
      const element = document.createElement("div")
      element.textContent = "This is a test text for preview"

      const preview = getElementPreview(element)

      expect(preview).toBe("This is a test text for preview")
    })

    it("应该截断过长的文本", () => {
      const element = document.createElement("div")
      element.textContent = "This is a very long text that exceeds fifty characters limit"

      const preview = getElementPreview(element)

      expect(preview.length).toBeLessThanOrEqual(50)
    })

    it("应该返回标签名（当元素无文本时）", () => {
      const element = document.createElement("img")

      const preview = getElementPreview(element)

      expect(preview).toBe("<img />")
    })
  })

  describe("getDOMContext", () => {
    it("应该返回父元素的上下文", () => {
      container.innerHTML = `
        <div id="parent" class="container">
          <div class="wrapper">
            <span class="item">Content</span>
          </div>
        </div>
      `

      const element = container.querySelector(".item")!
      const context = getDOMContext(element, 2)

      expect(context).toContain("wrapper")
      expect(context).toContain("parent")
    })

    it("应该限制上下文深度", () => {
      container.innerHTML = `
        <div id="level1">
          <div id="level2">
            <div id="level3">
              <span class="item">Content</span>
            </div>
          </div>
        </div>
      `

      const element = container.querySelector(".item")!
      const context = getDOMContext(element, 2)

      // 应该只包含 2 层父元素
      expect(context).toContain("level3")
      expect(context).toContain("level2")
      expect(context).not.toContain("level1")
    })

    it("应该包含子元素数量", () => {
      // 创建嵌套结构
      const grandParent = document.createElement("div")
      grandParent.id = "grandparent"

      const parent = document.createElement("div")
      parent.id = "parent"

      // 父元素有 3 个子元素
      for (let i = 1; i <= 3; i++) {
        parent.appendChild(document.createElement("span"))
      }

      grandParent.appendChild(parent)
      container.appendChild(grandParent)

      const element = parent.querySelector("span")!
      const context = getDOMContext(element, 1)

      // element 的父元素是 parent，它有 3 个子元素
      expect(context).toContain("(3 children)")
    })
  })
})

// Helper function for afterEach
function afterEach(callback: () => void) {
  // vitest 会自动处理
}
