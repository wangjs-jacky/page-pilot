/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest"
import { injectBodyHTML, ensureCSSPolyfill } from "../fixtures/fixture-loader"

function extractVideoCards(): Record<string, any>[] {
  const results: Record<string, any>[] = []
  document.querySelectorAll(".video-card").forEach((card: Element) => {
    const titleEl = card.querySelector(".title")
    const urlEl = card.querySelector("a.cover-link")
    const coverEl = card.querySelector(".cover")
    const authorEl = card.querySelector(".up-name")
    const playEl = card.querySelector(".play-text")
    const durationEl = card.querySelector(".duration")
    const dateEl = card.querySelector(".publish-date")

    results.push({
      title: titleEl ? titleEl.textContent.trim() : null,
      url: urlEl ? urlEl.getAttribute("href") : null,
      coverUrl: coverEl ? coverEl.getAttribute("src") : null,
      author: authorEl ? authorEl.textContent.trim() : null,
      playCount: playEl ? playEl.textContent.trim() : null,
      duration: durationEl ? durationEl.textContent.trim() : null,
      publishDate: dateEl ? dateEl.textContent.trim() : null,
    })
  })
  return results
}

function extractProducts(): Record<string, any>[] {
  const results: Record<string, any>[] = []
  document.querySelectorAll(".product-item").forEach((item: Element) => {
    const nameEl = item.querySelector(".product-name")
    const priceEl = item.querySelector(".current-price")
    const originalEl = item.querySelector(".original-price")
    const shopEl = item.querySelector(".shop-name")
    const salesEl = item.querySelector(".sales")
    const ratingEl = item.querySelector(".rating")
    const linkEl = item.querySelector(".product-link")

    let price: number | null = null
    if (priceEl) {
      const priceText = priceEl.textContent.replace(/[¥￥]/g, "").trim()
      price = parseFloat(priceText)
    }
    let originalPrice: number | null = null
    if (originalEl) {
      const priceText = originalEl.textContent.replace(/[¥￥]/g, "").trim()
      originalPrice = parseFloat(priceText)
    }

    results.push({
      name: nameEl ? nameEl.textContent.trim() : null,
      price,
      originalPrice,
      shop: shopEl ? shopEl.textContent.trim() : null,
      sales: salesEl ? salesEl.textContent.trim() : null,
      rating: ratingEl ? ratingEl.textContent.trim() : null,
      url: linkEl ? linkEl.getAttribute("href") : null,
      spu: item.getAttribute("data-spu"),
    })
  })
  return results
}

describe("Script Execution - video card extraction", () => {
  it("extract 10 video cards with all fields from bilibili-style HTML", () => {
    injectBodyHTML("video-cards.html")
    ensureCSSPolyfill()

    const results = extractVideoCards()

    expect(results).toHaveLength(10)
    expect(results[0].title).toBe("AI 从入门到精通 - 第一集 基础概念")
    expect(results[0].url).toContain("BV1xx411c7mD")
    expect(results[0].coverUrl).toBe("https://example.com/cover1.jpg")
    expect(results[0].author).toBe("科技频道")
    expect(results[0].playCount).toContain("播放")
    expect(results[0].duration).toBe("12:34")
    expect(results[0].publishDate).toBe("2024-03-15")
  })

  it("all card titles are non-empty", () => {
    injectBodyHTML("video-cards.html")
    ensureCSSPolyfill()
    const results = extractVideoCards()
    results.forEach((r) => expect(r.title).toBeTruthy())
  })

  it("author and playCount extracted correctly for second card", () => {
    injectBodyHTML("video-cards.html")
    ensureCSSPolyfill()
    const results = extractVideoCards()
    expect(results[1].author).toBe("ML大师")
    expect(results[1].playCount).toContain("万播放")
  })
})

describe("Script Execution - product list extraction", () => {
  it("extract product info from e-commerce HTML", () => {
    injectBodyHTML("product-list.html")
    ensureCSSPolyfill()

    const results = extractProducts()

    expect(results).toHaveLength(10)
    expect(results[0].name).toContain("蓝牙耳机")
    expect(results[0].price).toBe(199)
    expect(results[0].originalPrice).toBe(399)
    expect(results[0].url).toBe("/product/1001")
    expect(results[0].spu).toBe("1001")
  })

  it("all prices are valid numbers", () => {
    injectBodyHTML("product-list.html")
    ensureCSSPolyfill()
    const results = extractProducts()
    expect(results.every((r) => typeof r.price === "number")).toBe(true)
  })
})

describe("Script Execution - edge cases", () => {
  it("empty page returns empty array", () => {
    document.body.innerHTML = "<div>empty</div>"
    const els = document.querySelectorAll(".non-existent")
    expect(els).toHaveLength(0)
  })

  it("missing sub-elements return null", () => {
    document.body.innerHTML =
      '<div class="card"><h3 class="title">has title</h3></div><div class="card"></div>'
    const results: Record<string, any>[] = []
    document.querySelectorAll(".card").forEach((c) => {
      results.push({ title: c.querySelector(".title")?.textContent?.trim() || null })
    })
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe("has title")
    expect(results[1].title).toBeNull()
  })

  it("extract data-* attributes", () => {
    document.body.innerHTML =
      '<div class="item" data-id="001" data-price="199" data-category="electronics">Item 1</div>' +
      '<div class="item" data-id="002" data-price="399" data-category="clothing">Item 2</div>'
    const results: Record<string, any>[] = []
    document.querySelectorAll(".item").forEach((el) => {
      results.push({
        id: el.getAttribute("data-id"),
        price: el.getAttribute("data-price"),
        category: el.getAttribute("data-category"),
      })
    })
    expect(results).toEqual([
      { id: "001", price: "199", category: "electronics" },
      { id: "002", price: "399", category: "clothing" },
    ])
  })

  it("nested selectors work correctly", () => {
    document.body.innerHTML =
      '<div class="card"><div class="card-footer"><div class="price-box"><span class="current-price">199</span></div></div></div>'
    const card = document.querySelector(".card")!
    const nested = card.querySelector(".card-footer .price-box .current-price")
    expect(nested?.textContent).toBe("199")
  })
})

describe("Script Execution - auto-generated class filtering", () => {
  it("ignore css-*/sc-*/_* prefixed classes", () => {
    injectBodyHTML("mixed-classes.html")
    ensureCSSPolyfill()
    const items = document.querySelectorAll(".card-item")
    expect(items).toHaveLength(3)
  })

  it("select by semantic class name", () => {
    injectBodyHTML("mixed-classes.html")
    ensureCSSPolyfill()
    const items = document.querySelectorAll(".important-item")
    const labels = Array.from(items).map((el) =>
      (el.textContent || "").replace(/\s+/g, " ").trim()
    )
    expect(labels).toEqual(["重要标签 查看详情", "另一个标签 查看更多"])
  })
})
