import { describe, it, expect } from "vitest"
import {
  buildAnalysisPrompt,
  buildSmartCodePrompt,
  extractCodeFromResponse,
} from "./prompt-builder"
import type { ElementCapture, AIFieldCandidate, PaginationConfig } from "../types"

describe("Prompt Builder", () => {
  describe("buildAnalysisPrompt", () => {
    const mockCapture: ElementCapture = {
      selector: "div.video-card:nth-child(3)",
      tagName: "DIV",
      text: "AI Tutorial Episode 1",
      outerHTML: '<div class="video-card"><h3 class="title">AI Tutorial</h3></div>',
      parentContext: "div.video-list (10 children)",
      siblingCount: 10,
    }

    it("user prompt 包含元素 HTML", () => {
      const { userPrompt } = buildAnalysisPrompt(mockCapture)
      expect(userPrompt).toContain(mockCapture.outerHTML)
    })

    it("user prompt 包含选择器", () => {
      const { userPrompt } = buildAnalysisPrompt(mockCapture)
      expect(userPrompt).toContain(mockCapture.selector)
    })

    it("user prompt 包含同级元素数量", () => {
      const { userPrompt } = buildAnalysisPrompt(mockCapture)
      expect(userPrompt).toContain(String(mockCapture.siblingCount))
    })

    it("user prompt 包含父容器结构", () => {
      const { userPrompt } = buildAnalysisPrompt(mockCapture)
      expect(userPrompt).toContain(mockCapture.parentContext)
    })

    it("system prompt 要求 JSON 输出", () => {
      const { systemPrompt } = buildAnalysisPrompt(mockCapture)
      expect(systemPrompt).toContain("JSON")
      expect(systemPrompt).toContain("```json")
    })

    it("user prompt 指定了 JSON 返回格式", () => {
      const { userPrompt } = buildAnalysisPrompt(mockCapture)
      expect(userPrompt).toContain("cardSelector")
      expect(userPrompt).toContain("containerSelector")
      expect(userPrompt).toContain("paginationHint")
    })
  })

  describe("buildSmartCodePrompt", () => {
    const mockFields: AIFieldCandidate[] = [
      {
        name: "title",
        selector: ".title",
        attribute: "textContent",
        sampleValue: "AI Tutorial",
        confidence: "high",
      },
      {
        name: "viewCount",
        selector: ".play-text",
        attribute: "textContent",
        sampleValue: "1.2万播放",
        confidence: "medium",
      },
    ]

    it("包含所有字段信息", () => {
      const { userPrompt } = buildSmartCodePrompt(mockFields, ".video-card", ".video-list")
      expect(userPrompt).toContain("title")
      expect(userPrompt).toContain(".title")
      expect(userPrompt).toContain("textContent")
      expect(userPrompt).toContain("viewCount")
      expect(userPrompt).toContain("1.2万播放")
    })

    it("包含卡片和容器选择器", () => {
      const { userPrompt } = buildSmartCodePrompt(mockFields, ".video-card", ".video-list")
      expect(userPrompt).toContain(".video-card")
      expect(userPrompt).toContain(".video-list")
    })

    it("启用分页时包含提示", () => {
      const pagination: PaginationConfig = {
        enabled: true,
        mode: "click",
        nextButtonSelector: ".next-btn",
        maxPages: 5,
        waitMs: 2000,
      }
      const { userPrompt } = buildSmartCodePrompt(mockFields, ".card", ".list", pagination)
      expect(userPrompt).toContain("分页")
    })

    it("未启用分页时不包含提示", () => {
      const { userPrompt } = buildSmartCodePrompt(mockFields, ".card", ".list")
      expect(userPrompt).not.toContain("分页")
    })

    it("system prompt 包含代码生成规则", () => {
      const { systemPrompt } = buildSmartCodePrompt(mockFields, ".card", ".list")
      expect(systemPrompt).toContain("querySelectorAll")
      expect(systemPrompt).toContain("MAIN world")
    })
  })

  describe("extractCodeFromResponse", () => {
    it("提取 ```javascript``` 代码块", () => {
      const response = "这是生成的代码：\n```javascript\nconst x = 1;\n```\n以上是代码。"
      expect(extractCodeFromResponse(response)).toBe("const x = 1;")
    })

    it("提取 ```js``` 代码块", () => {
      const response = "```js\nconst items = [];\nreturn items;\n```"
      expect(extractCodeFromResponse(response)).toBe("const items = [];\nreturn items;")
    })

    it("提取裸 ``` 代码块", () => {
      const response = "```\nconst data = [];\n```"
      expect(extractCodeFromResponse(response)).toBe("const data = [];")
    })

    it("无代码块时返回原文（trim）", () => {
      const response = "  const x = 1;  "
      expect(extractCodeFromResponse(response)).toBe("const x = 1;")
    })

    it("处理多行代码", () => {
      const code = `(function() {\n  const results = [];\n  document.querySelectorAll('.card').forEach(card => {\n    results.push({ title: card.textContent });\n  });\n  return results;\n})()`
      const response = `\`\`\`javascript\n${code}\n\`\`\``
      expect(extractCodeFromResponse(response)).toBe(code)
    })

    it("处理 ```javascript 后没有换行的情况", () => {
      const response = "```javascript\nconst x = 1;\n```"
      expect(extractCodeFromResponse(response)).toBe("const x = 1;")
    })
  })
})
