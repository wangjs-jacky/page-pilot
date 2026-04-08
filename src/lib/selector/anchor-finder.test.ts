/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { findSemanticAnchors, _internal } from "./anchor-finder"

// Polyfill CSS.escape for jsdom
if (typeof CSS === "undefined" || !CSS.escape) {
  global.CSS = {
    escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
  } as any
}

describe("Anchor Finder", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  describe("getAnchorScore", () => {
    it("应该识别 data-testid 锚点", () => {
      container.innerHTML = `<div data-testid="product-list"><span>Item</span></div>`
      const el = container.querySelector("div")!
      const score = _internal.getAnchorScore(el)

      expect(score).not.toBeNull()
      expect(score!.type).toBe("data-attr")
      expect(score!.score).toBe(95)
    })

    it("应该识别 aria-label 锚点", () => {
      container.innerHTML = `<nav aria-label="主导航"><a>Link</a></nav>`
      const el = container.querySelector("nav")!
      const score = _internal.getAnchorScore(el)

      expect(score).not.toBeNull()
      expect(score!.type).toBe("aria-attr")
    })

    it("应该识别稳定 id 锚点", () => {
      container.innerHTML = `<div id="main-content"><p>Text</p></div>`
      const el = container.querySelector("div")!
      const score = _internal.getAnchorScore(el)

      expect(score).not.toBeNull()
      expect(score!.type).toBe("id")
      expect(score!.value).toBe("main-content")
    })

    it("应该拒绝随机 id", () => {
      container.innerHTML = `<div id="a1b2c3d4e5f6"><p>Text</p></div>`
      const el = container.querySelector("div")!
      const score = _internal.getAnchorScore(el)

      // 不应该用 id 做锚点，但可能用文本内容
      if (score) {
        expect(score.type).not.toBe("id")
      }
    })

    it("应该识别文本锚点", () => {
      container.innerHTML = `<h2>商品列表</h2>`
      const el = container.querySelector("h2")!
      const score = _internal.getAnchorScore(el)

      expect(score).not.toBeNull()
      expect(score!.type).toBe("text-content")
      expect(score!.value).toBe("商品列表")
    })

    it("无语义属性的元素不应该有锚点", () => {
      container.innerHTML = `<div class="css-abc"><span class="inner">123</span></div>`
      const el = container.querySelector("span")!
      const score = _internal.getAnchorScore(el)

      expect(score).toBeNull()
    })
  })

  describe("findSemanticAnchors", () => {
    it("应该从祖先找到 data-testid 锚点", () => {
      container.innerHTML = `
        <section data-testid="video-list">
          <div>
            <div>
              <span class="title">Video Title</span>
            </div>
          </div>
        </section>
      `
      const target = container.querySelector(".title")!
      const anchors = findSemanticAnchors(target)

      expect(anchors.length).toBeGreaterThan(0)
      const dataAnchor = anchors.find(a => a.anchorType === "data-attr")
      expect(dataAnchor).toBeDefined()
      expect(dataAnchor!.selector).toContain("data-testid")
      expect(dataAnchor!.relativePath).toBeTruthy()
      expect(dataAnchor!.distance).toBe(3)
    })

    it("应该从祖先找到 id 锚点", () => {
      container.innerHTML = `
        <div id="product-grid">
          <div>
            <span class="price">¥99</span>
          </div>
        </div>
      `
      const target = container.querySelector(".price")!
      const anchors = findSemanticAnchors(target)

      const idAnchor = anchors.find(a => a.anchorType === "id")
      expect(idAnchor).toBeDefined()
      expect(idAnchor!.anchorValue).toBe("product-grid")
    })

    it("无语义属性时应返回空数组", () => {
      container.innerHTML = `
        <div>
          <div>
            <span>Plain text</span>
          </div>
        </div>
      `
      const target = container.querySelector("span")!
      const anchors = findSemanticAnchors(target)

      expect(anchors).toEqual([])
    })

    it("应该按质量排序（稳定性/距离）", () => {
      container.innerHTML = `
        <div id="good-anchor">
          <div data-testid="best-anchor">
            <span class="target">Item</span>
          </div>
        </div>
      `
      const target = container.querySelector(".target")!
      const anchors = findSemanticAnchors(target)

      expect(anchors.length).toBeGreaterThanOrEqual(2)
      // data-testid 应排在 id 前面（更近 + 更稳定）
      expect(anchors[0].anchorType).toBe("data-attr")
    })

    it("应该限制最大锚点数量", () => {
      container.innerHTML = `
        <div data-testid="a" aria-label="b" id="c">
          <div data-role="d">
            <span>Target</span>
          </div>
        </div>
      `
      const target = container.querySelector("span")!
      const anchors = findSemanticAnchors(target)

      expect(anchors.length).toBeLessThanOrEqual(3)
    })

    it("应该限制最大搜索距离", () => {
      container.innerHTML = `
        <div data-testid="far-away">
          <div><div><div><div><div>
            <span>Deep target</span>
          </div></div></div></div></div>
        </div>
      `
      const target = container.querySelector("span")!
      const anchors = findSemanticAnchors(target, 3) // 限制 3 层

      // 距离 6 超过限制 3，不应被找到
      const farAnchor = anchors.find(a => a.anchorValue.includes("far-away"))
      expect(farAnchor).toBeUndefined()
    })
  })

  describe("computeRelativePath", () => {
    it("应该用语义 class 避免不必要的 nth-child", () => {
      container.innerHTML = `
        <div data-testid="list">
          <span class="title">Title</span>
          <span class="desc">Desc</span>
        </div>
      `
      const ancestor = container.querySelector("[data-testid]")!
      const target = container.querySelector(".desc")!
      const path = _internal.computeRelativePath(ancestor, target)

      expect(path).toContain("desc")
    })
  })
})
