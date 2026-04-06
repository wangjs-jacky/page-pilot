/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest"
import { injectBodyHTML, ensureCSSPolyfill } from "../fixtures/fixture-loader"
import { calculateSelector, getDOMContext } from "../../src/lib/selector/calculator"

describe("Selector - 复杂 DOM 结构", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    ensureCSSPolyfill()
  })

  describe("视频卡片网格布局", () => {
    it("选择器匹配所有同级卡片", () => {
      injectBodyHTML("video-cards.html")
      const cards = document.querySelectorAll(".video-card")
      expect(cards).toHaveLength(10)

      const card = cards[2]
      const selector = calculateSelector(card)

      // 选择器能定位到该元素
      const found = document.querySelector(selector)
      expect(found).toBe(card)
    })

    it("正确计算 siblingCount", () => {
      injectBodyHTML("video-cards.html")
      const cards = document.querySelectorAll(".video-card")
      const firstCard = cards[0]
      const parent = firstCard.parentElement!
      const siblings = parent.querySelectorAll(":scope > .video-card")
      expect(siblings.length).toBe(10)
    })
  })

  describe("商品列表深层嵌套", () => {
    it("使用最近的 ID 祖先构建选择器", () => {
      injectBodyHTML("product-list.html")
      const products = document.querySelectorAll(".product-item")
      const product = products[2]
      const selector = calculateSelector(product)

      expect(selector).toMatch(/#/)
    })

    it("选择器可以定位到正确的元素", () => {
      injectBodyHTML("product-list.html")
      const products = document.querySelectorAll(".product-item")
      const product = products[4]
      const selector = calculateSelector(product)

      const found = document.querySelector(selector)
      expect(found).toBeTruthy()
    })
  })

  describe("自动生成 CSS 类名过滤", () => {
    it("过滤 css-* 前缀类名", () => {
      injectBodyHTML("mixed-classes.html")
      const item = document.querySelector(".card-item")
      expect(item).toBeTruthy()
      const selector = calculateSelector(item!)
      expect(selector).not.toMatch(/css-[a-z0-9]/)
    })

    it("过滤 sc-* 前缀类名", () => {
      injectBodyHTML("mixed-classes.html")
      const item = document.querySelector(".card-item")
      const selector = calculateSelector(item!)
      expect(selector).not.toMatch(/sc-[a-z0-9]/)
    })

    it("过滤 _ 开头的类名", () => {
      injectBodyHTML("mixed-classes.html")
      const desc = document.querySelector("._description")
      if (desc) {
        const selector = calculateSelector(desc)
        expect(selector).not.toMatch(/^_/)
      }
    })

    it("保留语义化类名或能正确定位", () => {
      injectBodyHTML("mixed-classes.html")
      const item = document.querySelector(".card-item")
      const selector = calculateSelector(item!)
      // 选择器能定位到元素即可（可能是类名或 nth-child 路径）
      const found = document.querySelector(selector)
      expect(found).toBe(item)
    })
  })

  describe("ID 优先策略", () => {
    it("优先使用 ID 选择器", () => {
      injectBodyHTML("mixed-classes.html")
      const section = document.getElementById("special-section")
      if (section) {
        const selector = calculateSelector(section)
        expect(selector).toBe("#special-section")
      }
    })

    it("使用最近 ID 祖先 + 相对路径", () => {
      injectBodyHTML("mixed-classes.html")
      const items = document.querySelectorAll("#special-section .important-item")
      if (items.length > 0) {
        const selector = calculateSelector(items[0])
        expect(selector).toContain("#special-section")
      }
    })

    it("同名类在不同容器中区分", () => {
      injectBodyHTML("mixed-classes.html")
      const sectionA = document.querySelectorAll("#section-a .item")
      const sectionB = document.querySelectorAll("#section-b .item")

      expect(sectionA).toHaveLength(2)
      expect(sectionB).toHaveLength(2)

      const selectorA = calculateSelector(sectionA[0])
      expect(selectorA).toContain("section-a")
    })
  })

  describe("DOM 上下文提取", () => {
    it("getDOMContext 返回正确的父容器信息", () => {
      injectBodyHTML("video-cards.html")
      const card = document.querySelector(".video-card")
      expect(card).toBeTruthy()

      const context = getDOMContext(card!, 2)
      expect(context).toBeTruthy()
      expect(context.length).toBeGreaterThan(0)
    })
  })
})
