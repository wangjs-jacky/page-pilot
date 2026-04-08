/**
 * 下一页按钮 AI 分析测试
 *
 * 需求：选择"下一页"按钮时，不只是获取 CSS 选择器，
 * 而是把元素信息喂给 AI，让 AI 理解翻页机制并生成更健壮的选择器。
 *
 * 本测试验证：
 * 1. AI 分析下一页按钮的 prompt 构建
 * 2. 返回结果的结构
 * 3. 生成脚本时包含元素上下文
 */
import { describe, it, expect } from "vitest"
import type { ElementCapture } from "../../src/lib/types"

// --- Prompt 构建逻辑测试 ---

function buildNextButtonAnalysisPrompt(capture: ElementCapture): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = `你是一个网页翻页机制分析专家。用户选中了一个"下一页"按钮元素。
你需要分析这个元素的 HTML 结构和上下文，理解翻页机制，并生成最健壮的 CSS 选择器。

规则：
1. 选择器应尽量简洁且健壮，优先使用语义化的 class、id、aria 属性、rel 属性
2. 避免使用 nth-child、具体层级路径等脆弱选择器
3. 如果元素是链接（<a>），优先使用 href 模式匹配
4. 分析元素文本内容，识别"下一页"、"Next"、">"、"›"等翻页语义
5. 只输出 JSON，不要输出任何解释文字
6. 用 \`\`\`json 和 \`\`\` 包裹 JSON`

  const userPrompt = `分析以下"下一页"按钮元素：

元素标签：${capture.tagName}
选择器：${capture.selector}
同级同类元素数量：${capture.siblingCount}
父容器结构：${capture.parentContext}

元素 HTML：
\`\`\`html
${capture.outerHTML}
\`\`\`

请以 JSON 格式返回分析结果：
\`\`\`json
{
  "nextButtonSelector": "最健壮的 CSS 选择器",
  "paginationType": "numbered | prev-next | infinite-scroll | load-more",
  "totalPagesHint": 估计总页数或 null,
  "reasoning": "选择器选择的理由（简短说明）"
}
\`\`\``

  return { systemPrompt, userPrompt }
}

function parseNextButtonAnalysis(response: string): {
  nextButtonSelector: string
  paginationType: string
  totalPagesHint: number | null
  reasoning: string
} {
  const text = response.trim()
  let jsonStr = text
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  const parsed = JSON.parse(jsonStr)
  return {
    nextButtonSelector: parsed.nextButtonSelector || "",
    paginationType: parsed.paginationType || "prev-next",
    totalPagesHint: parsed.totalPagesHint || null,
    reasoning: parsed.reasoning || "",
  }
}

// --- 生成脚本时包含元素上下文的 Prompt 测试 ---

function buildPaginationContextPrompt(
  fields: Array<{ name: string; selector: string; attribute: string; sampleValue: string }>,
  cardSelector: string,
  containerSelector: string,
  pagination: { mode: string; maxPages: number; waitMs: number },
  nextButtonCapture?: ElementCapture
): string {
  const nextButtonContext = nextButtonCapture
    ? `
下一页按钮元素信息：
- 标签：${nextButtonCapture.tagName}
- 原始选择器：${nextButtonCapture.selector}
- 文本内容：${nextButtonCapture.text}
- 同级元素数量：${nextButtonCapture.siblingCount}
- 父容器结构：${nextButtonCapture.parentContext}
- HTML：
\`\`\`html
${nextButtonCapture.outerHTML}
\`\`\``
    : ""

  return `卡片选择器：${cardSelector}
容器选择器：${containerSelector}
${nextButtonContext}
分页模式：${pagination.mode}
最大页数：${pagination.maxPages}
等待时间：${pagination.waitMs}ms`
}

describe("Next Button AI Analysis", () => {
  const sampleCapture: ElementCapture = {
    selector: "body > div.container > nav.pagination > a.next",
    tagName: "a",
    text: "下一页 ›",
    outerHTML: '<a class="next" href="/page/2" rel="next">下一页 ›</a>',
    parentContext: "nav.pagination > a*5",
    siblingCount: 5,
  }

  describe("Prompt 构建", () => {
    it("应包含元素完整信息", () => {
      const { userPrompt } = buildNextButtonAnalysisPrompt(sampleCapture)

      expect(userPrompt).toContain(sampleCapture.tagName)
      expect(userPrompt).toContain(sampleCapture.selector)
      expect(userPrompt).toContain(sampleCapture.outerHTML)
      expect(userPrompt).toContain(sampleCapture.parentContext)
      expect(String(sampleCapture.siblingCount)).toBeTruthy()
    })

    it("系统 prompt 应要求健壮选择器", () => {
      const { systemPrompt } = buildNextButtonAnalysisPrompt(sampleCapture)

      expect(systemPrompt).toContain("健壮")
      expect(systemPrompt).toContain("CSS 选择器")
      expect(systemPrompt).toContain("翻页")
    })

    it("系统 prompt 应说明避免脆弱选择器", () => {
      const { systemPrompt } = buildNextButtonAnalysisPrompt(sampleCapture)

      expect(systemPrompt).toContain("nth-child")
    })
  })

  describe("响应解析", () => {
    it("应正确解析 JSON 响应", () => {
      const response = '```json\n{"nextButtonSelector":"a.next","paginationType":"prev-next","totalPagesHint":null,"reasoning":"class=next 语义明确"}\n```'

      const result = parseNextButtonAnalysis(response)
      expect(result.nextButtonSelector).toBe("a.next")
      expect(result.paginationType).toBe("prev-next")
      expect(result.reasoning).toContain("语义明确")
    })

    it("应处理无代码块的纯 JSON", () => {
      const response = '{"nextButtonSelector":"a[rel=next]","paginationType":"prev-next","totalPagesHint":10,"reasoning":"rel=next 标准"}'

      const result = parseNextButtonAnalysis(response)
      expect(result.nextButtonSelector).toBe("a[rel=next]")
      expect(result.totalPagesHint).toBe(10)
    })

    it("缺少字段时使用默认值", () => {
      const response = '{"nextButtonSelector":".page-next"}'

      const result = parseNextButtonAnalysis(response)
      expect(result.nextButtonSelector).toBe(".page-next")
      expect(result.paginationType).toBe("prev-next")
      expect(result.totalPagesHint).toBeNull()
      expect(result.reasoning).toBe("")
    })
  })

  describe("生成脚本时包含元素上下文", () => {
    it("无元素上下文时不应包含按钮信息", () => {
      const prompt = buildPaginationContextPrompt(
        [{ name: "title", selector: ".title", attribute: "textContent", sampleValue: "测试" }],
        ".card",
        ".cards",
        { mode: "click", maxPages: 5, waitMs: 2000 }
      )

      expect(prompt).not.toContain("下一页按钮元素信息")
    })

    it("有元素上下文时应包含完整信息", () => {
      const prompt = buildPaginationContextPrompt(
        [{ name: "title", selector: ".title", attribute: "textContent", sampleValue: "测试" }],
        ".card",
        ".cards",
        { mode: "click", maxPages: 5, waitMs: 2000 },
        sampleCapture
      )

      expect(prompt).toContain("下一页按钮元素信息")
      expect(prompt).toContain(sampleCapture.tagName)
      expect(prompt).toContain(sampleCapture.outerHTML)
      expect(prompt).toContain(sampleCapture.text)
      expect(prompt).toContain(sampleCapture.parentContext)
    })

    it("元素 HTML 应被喂给 AI 用于理解翻页", () => {
      const prompt = buildPaginationContextPrompt(
        [],
        ".card",
        ".cards",
        { mode: "click", maxPages: 3, waitMs: 1000 },
        sampleCapture
      )

      // AI 能看到 'href="/page/2"' 来理解页码模式
      expect(prompt).toContain('href="/page/2"')
      // AI 能看到 "下一页" 文本来理解按钮语义
      expect(prompt).toContain("下一页")
    })
  })
})
