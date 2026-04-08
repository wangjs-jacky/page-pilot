/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { generateSelectorCandidates, getBestSelector, _internal } from "./selector-generator"

// Polyfill CSS.escape for jsdom
if (typeof CSS === "undefined" || !CSS.escape) {
  global.CSS = {
    escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
  } as any
}

describe("Selector Generator", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  describe("isStableId", () => {
    it("应该识别稳定 id", () => {
      expect(_internal.isStableId("product-list")).toBe(true)
      expect(_internal.isStableId("search-form")).toBe(true)
    })

    it("应该拒绝自动生成的 id", () => {
      expect(_internal.isStableId("123")).toBe(false)
      expect(_internal.isStableId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(false)
      expect(_internal.isStableId("rb-123")).toBe(false)
    })
  })

  describe("isSemanticClass", () => {
    it("应该识别业务语义 class", () => {
      expect(_internal.isSemanticClass("product-name")).toBe(true)
      expect(_internal.isSemanticClass("title")).toBe(true)
      expect(_internal.isSemanticClass("video-card")).toBe(true)
    })

    it("应该拒绝 hash class", () => {
      expect(_internal.isSemanticClass("css-abc123")).toBe(false)
      expect(_internal.isSemanticClass("sc-def456")).toBe(false)
      expect(_internal.isSemanticClass("_private")).toBe(false)
      expect(_internal.isSemanticClass("data-v-abc")).toBe(false)
      expect(_internal.isSemanticClass("ab")).toBe(false) // 太短
    })
  })

  describe("generateSelectorCandidates", () => {
    it("应该为 data-testid 生成最高分候选", () => {
      container.innerHTML = `<div data-testid="product-card">Product</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const dataCandidate = candidates.find(c => c.strategy === "data-attr")
      expect(dataCandidate).toBeDefined()
      expect(dataCandidate!.stabilityScore).toBeGreaterThanOrEqual(90)
      expect(dataCandidate!.selector).toContain("data-testid")
    })

    it("应该为 aria-label 生成高分候选", () => {
      container.innerHTML = `<button aria-label="提交">Submit</button>`
      const el = container.querySelector("button")!
      const candidates = generateSelectorCandidates(el)

      const ariaCandidate = candidates.find(c => c.strategy === "aria-attr")
      expect(ariaCandidate).toBeDefined()
      expect(ariaCandidate!.stabilityScore).toBeGreaterThanOrEqual(80)
    })

    it("应该为稳定 id 生成高分候选", () => {
      container.innerHTML = `<div id="main-content">Content</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const idCandidate = candidates.find(c => c.strategy === "id")
      expect(idCandidate).toBeDefined()
      expect(idCandidate!.selector).toBe("#main-content")
      expect(idCandidate!.stabilityScore).toBeGreaterThanOrEqual(85)
    })

    it("应该拒绝自动生成的随机 id", () => {
      container.innerHTML = `<div id="a1b2c3d4e5f6g7h8i9j0">Random</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const idCandidate = candidates.find(c => c.strategy === "id")
      expect(idCandidate).toBeUndefined()
    })

    it("应该为语义 class 生成中等分候选", () => {
      container.innerHTML = `<div class="product-name">Name</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const classCandidate = candidates.find(c => c.strategy === "semantic-class")
      expect(classCandidate).toBeDefined()
      expect(classCandidate!.stabilityScore).toBeGreaterThanOrEqual(60)
      expect(classCandidate!.selector).toContain("product-name")
    })

    it("应该为 hash class 生成低分候选", () => {
      container.innerHTML = `<div class="css-abc123 sc-def456">Styled</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const hashCandidate = candidates.find(c => c.strategy === "hash-class")
      expect(hashCandidate).toBeDefined()
      expect(hashCandidate!.stabilityScore).toBeLessThanOrEqual(35)
    })

    it("无任何属性时应该降级到 nth-child", () => {
      container.innerHTML = `<div><span>Text</span></div>`
      const el = container.querySelector("span")!
      const candidates = generateSelectorCandidates(el)

      const nthCandidate = candidates.find(c => c.strategy === "nth-child")
      expect(nthCandidate).toBeDefined()
      expect(nthCandidate!.stabilityScore).toBeLessThanOrEqual(20)
    })

    it("应该按稳定性评分降序排列", () => {
      container.innerHTML = `<div data-testid="card" class="product" id="card-1">Card</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].stabilityScore).toBeGreaterThanOrEqual(candidates[i].stabilityScore)
      }
    })

    it("应该去重相同选择器", () => {
      container.innerHTML = `<div class="item">Item</div>`
      const el = container.querySelector("div")!
      const candidates = generateSelectorCandidates(el)

      const selectors = candidates.map(c => c.selector)
      expect(new Set(selectors).size).toBe(selectors.length)
    })

    it("应该支持祖先锚定策略", () => {
      container.innerHTML = `
        <div data-testid="product-list">
          <div>
            <span class="name">Product</span>
          </div>
        </div>
      `
      const el = container.querySelector(".name")!
      const candidates = generateSelectorCandidates(el)

      // 应该有基于祖先 data-testid 的候选
      const anchored = candidates.find(c => c.strategy === "data-attr" && c.selector.includes("product-list"))
      expect(anchored).toBeDefined()
    })

    it("应该包含 name 属性候选", () => {
      container.innerHTML = `<input name="search" type="text" />`
      const el = container.querySelector("input")!
      const candidates = generateSelectorCandidates(el)

      const attrCandidate = candidates.find(c => c.strategy === "attribute")
      expect(attrCandidate).toBeDefined()
      expect(attrCandidate!.selector).toContain("name")
    })
  })

  describe("getBestSelector", () => {
    it("应该返回高评分的唯一选择器", () => {
      container.innerHTML = `<div data-testid="unique-card">Card</div>`
      const el = container.querySelector("div")!

      const selector = getBestSelector(el)
      expect(selector).toContain("data-testid")
    })

    it("无高评分选择器时返回第一个候选", () => {
      container.innerHTML = `<div><span>Text</span></div>`
      const el = container.querySelector("span")!

      const selector = getBestSelector(el)
      expect(selector).toBeTruthy()
    })
  })
})
