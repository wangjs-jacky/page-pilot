import type { AIFieldCandidate, ElementCapture, PaginationConfig } from "../types"

// ==================== 分析 Prompt ====================

export function buildAnalysisPrompt(capture: ElementCapture): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = `你是一个网页结构分析专家。用户选中了一个页面元素（通常是列表中的重复卡片）。
你需要分析这个元素的 HTML 结构，找出所有有意义的、可提取的数据字段。

规则：
1. 字段名使用英文驼峰，如 title, viewCount, publishDate, coverUrl
2. 只提取有实际数据含义的字段，跳过纯装饰性元素（图标、分隔线、空白容器）
3. 优先提取：标题/名称、链接、图片、数字统计（播放量/评论数等）、日期时间、描述文本
4. 对于数字字段（播放量等），注明需要清洗（去 "万"、逗号等）
5. selector 应该是卡片内的相对路径，不依赖 nth-child
6. 如果能识别分页机制，填入 paginationHint
7. 只输出 JSON，不要输出任何解释文字
8. 用 \`\`\`json 和 \`\`\` 包裹 JSON
9. 如果提供了同级卡片样本，对比分析它们之间的结构差异，选择在所有样本中都稳定存在的选择器`

  const paginationSection = capture.paginationContext
    ? `\n页面分页区域 HTML（自动检测）：
\`\`\`html
${capture.paginationContext}
\`\`\``
    : ""

  const siblingSection = capture.siblingSamples?.length
    ? `\n同级卡片样本（用于分析 DOM 变化）：
${capture.siblingSamples.map((s, i) => `样本 ${i + 1}:\n\`\`\`html\n${s}\n\`\`\``).join("\n\n")}`
    : ""

  const userPrompt = `分析以下页面元素：

元素标签：${capture.tagName}
选择器：${capture.selector}
同级同类元素数量：${capture.siblingCount}
父容器结构：${capture.parentContext}

元素 HTML：
\`\`\`html
${capture.outerHTML}
\`\`\`
${paginationSection}
${siblingSection}

请以 JSON 格式返回分析结果，格式如下：
\`\`\`json
{
  "cardSelector": "单个卡片的通用 CSS 选择器（不含 nth-child 和具体位置）",
  "containerSelector": "包含所有同级卡片的容器选择器",
  "fields": [
    {
      "name": "英文驼峰字段名",
      "selector": "卡片内的相对 CSS 选择器",
      "attribute": "textContent | href | src | data-xxx",
      "sampleValue": "从 HTML 中看到的示例值",
      "confidence": "high | medium | low"
    }
  ],
  "paginationHint": {
    "type": "click-next 或 numbered 或 scroll 或 url 或 null",
    "nextButtonSelector": "下一页按钮的选择器或 null",
    "pageButtonSelector": "页码按钮的通用选择器（如 .pagination .page-item）或 null",
    "estimatedPages": 估计总页数或 null
  }
}
\`\`\``

  return { systemPrompt, userPrompt }
}

// ==================== 智能代码生成 Prompt ====================

export function buildSmartCodePrompt(
  fields: AIFieldCandidate[],
  cardSelector: string,
  containerSelector: string,
  pagination?: PaginationConfig
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `你是一个网页数据提取脚本生成器。
根据用户提供的字段信息和选择器，生成一段可以在浏览器中直接运行的 JavaScript 提取脚本。

关键要求：
1. 使用 querySelectorAll 找到页面上所有匹配的卡片元素
2. 对每个卡片，使用字段选择器（相对于卡片）提取对应数据
3. 数字字段需清洗：去除 "万"、"、"等，"1.8万" 转 18000
4. 链接字段补全为完整 URL（补 https: 前缀如果缺失）
5. 代码必须包裹在 IIFE 中，最后一行是求值表达式（不要用 return 语句）
6. 代码必须能在浏览器环境直接运行，不使用任何外部库
7. 处理元素不存在的情况（对应字段返回 null）
8. 只输出代码，不要输出解释文字
9. 代码用 \`\`\`javascript 和 \`\`\` 包裹
10. 调用 querySelector 前必须检查选择器是否为有效非空字符串。空字符串传给 querySelector 会抛 SyntaxError，应视为"没有下一页"并 break
11. 优先使用语义化属性（data-*, aria-*, role, href, src, alt）作为选择器，而非依赖不稳定的 class 名
12. 如果必须用 class 选择器，优先选择业务语义的 class（如 .product-name, .title），避免 hash 类 class（如 .css-abc123, .sc-def456, .data-v-xxx）
13. 每个字段的提取都应使用可选链或 null 合并保护，部分卡片缺失字段不应导致整个脚本崩溃

正确的代码格式示例：
(() => {
  const cards = document.querySelectorAll('.card');
  return [...cards].map(card => ({
    title: card.querySelector('.title')?.textContent?.trim() || '',
    link: card.querySelector('a')?.href || '',
  })).filter(v => v.title);
})()

注意：这段代码会被 (0, eval)(code) 执行（间接 eval），所以：
- 必须用 IIFE 包裹，最后的 () 让表达式立即求值
- IIFE 内部可以用 return，因为 return 在函数体内是合法的
- 不要在 IIFE 外部使用 return 语句`

  const fieldList = fields
    .map(
      (f) =>
        `- ${f.name}: 选择器 "${f.selector}"，提取属性 ${f.attribute}，示例值 "${f.sampleValue}"`
    )
    .join("\n")

  const userPrompt = pagination?.enabled
    ? buildPaginationUserPrompt(fields, cardSelector, containerSelector, pagination, fieldList)
    : buildSinglePageUserPrompt(fields, cardSelector, containerSelector, fieldList)

  return { systemPrompt, userPrompt }
}

// ==================== 单页脚本 Prompt ====================

function buildSinglePageUserPrompt(
  _fields: AIFieldCandidate[],
  cardSelector: string,
  containerSelector: string,
  fieldList: string
): string {
  return `请根据以下字段信息，生成网页数据提取脚本。

卡片选择器：${cardSelector}
容器选择器：${containerSelector}

需要提取的字段：
${fieldList}

脚本格式：
(() => {
  const cards = document.querySelectorAll('卡片选择器');
  return [...cards].map(card => ({
    // 提取各字段
  })).filter(v => v.title);
})()`
}

// ==================== 分页脚本 Prompt ====================

function buildPaginationUserPrompt(
  _fields: AIFieldCandidate[],
  cardSelector: string,
  containerSelector: string,
  pagination: PaginationConfig,
  fieldList: string
): string {
  // 构建下一页按钮的元素上下文（如果有的话）
  const nextButtonContext = pagination.nextButtonCapture
    ? `

下一页按钮元素信息（用户通过选择器选中的实际元素）：
- 标签：${pagination.nextButtonCapture.tagName}
- 文本内容：${pagination.nextButtonCapture.text}
- 同级元素数量：${pagination.nextButtonCapture.siblingCount}
- 父容器结构：${pagination.nextButtonCapture.parentContext}
- HTML：
\`\`\`html
${pagination.nextButtonCapture.outerHTML}
\`\`\``
    : ""

  const modeInstruction =
    pagination.mode === "click"
      ? `翻页方式：点击下一页按钮
  - 下一页按钮选择器：${pagination.nextButtonSelector || '（未提供）'}
  - **重要**：调用 document.querySelector() 前必须先检查选择器是否为非空字符串，空字符串会抛 SyntaxError
  - 如果选择器为空、按钮不存在或 disabled，终止循环
  - 点击后等待 ${pagination.waitMs}ms 让新内容加载`
      : pagination.mode === "numbered"
        ? `翻页方式：依次点击页码按钮
  - 页码按钮通用选择器：${pagination.pageButtonSelector || '（未提供）'}
  - **重要**：调用 document.querySelector() 前必须先检查选择器是否为非空字符串
  - 使用 querySelectorAll 找到所有匹配的页码按钮
  - 过滤：只保留 textContent 能解析为数字的按钮（忽略 "..."、"\u2192" 等）
  - 按数字排序，从第 2 页开始依次点击
  - 如果目标页码的按钮不存在，终止循环
  - 点击后等待 ${pagination.waitMs}ms 让新内容加载`
        : pagination.mode === "scroll"
          ? `翻页方式：滚动到底部加载更多
  - 使用 window.scrollTo(0, document.body.scrollHeight) 触发加载
  - 滚动后等待 ${pagination.waitMs}ms 让新内容加载
  - 注意：滚动加载可能会追加新卡片，也可能整页刷新，两种情况都要处理`
          : `翻页方式：URL 页码递增
  - 从当前 URL 提取 page 参数并递增
  - 使用 window.location.href 跳转到下一页
  - 跳转后等待 ${pagination.waitMs}ms`

  return `请根据以下字段信息，生成网页数据提取脚本。

注意：分页翻页由外部系统负责（点击下一页按钮、滚动等），你的脚本只需要提取当前页的数据。

卡片选择器：${cardSelector}
容器选择器：${containerSelector}
${nextButtonContext}

需要提取的字段：
${fieldList}

脚本格式（只提取当前页，不要包含分页循环）：
(() => {
  const cards = document.querySelectorAll('卡片选择器');
  return [...cards].map(card => ({
    // 提取各字段
  })).filter(v => v.title);
})()`
}

// ==================== 脚本优化 Prompt ====================

export function buildOptimizationPrompt(
  code: string,
  requirement: string,
  executionResult?: Record<string, any>[]
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `你是一个网页数据提取脚本优化专家。
用户有一个现有的 JavaScript 提取脚本，需要根据反馈进行优化。

常见优化场景：
1. 选择器修复 — 元素未找到，需要调整 CSS 选择器
2. 字段增加/删除 — 提取更多或更少的字段
3. 数据清洗 — 处理空值、格式化数字、补全 URL 等
4. 容错增强 — 处理动态加载、延迟渲染、元素不存在等情况
5. 性能优化 — 减少 DOM 查询、优化遍历逻辑

输出要求：
1. 输出优化后的完整脚本，使用 (() => { ... })() IIFE 格式
2. IIFE 内部可以用 return 返回数组
3. 只输出代码，不要输出解释文字
4. 代码用 \`\`\`javascript 和 \`\`\` 包裹
5. 代码必须能在浏览器中通过 (0, eval)(code) 执行`

  const resultSection = executionResult?.length
    ? `\n\n当前执行结果样本（前 3 条）：
\`\`\`json
${JSON.stringify(executionResult.slice(0, 3), null, 2)}
\`\`\``
    : ""

  const userPrompt = `当前脚本代码：
\`\`\`javascript
${code}
\`\`\`

用户的优化需求：
${requirement}
${resultSection}

请返回优化后的完整脚本代码。`

  return { systemPrompt, userPrompt }
}

// ==================== 代码提取工具 ====================

export function extractCodeFromResponse(response: string): string {
  // 提取 ```javascript ... ``` 中的代码
  const match = response.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/)
  if (match) return match[1].trim()
  // 如果没有代码块标记，尝试直接返回
  return response.trim()
}

// ==================== Dry-Run 修复 Prompt ====================

export interface DryRunFailure {
  type: "error" | "empty" | "partial"
  errorMessage?: string
  returnedData?: Record<string, any>[]
  cardCount?: number
  firstCardHTML?: string
}

export function buildDryRunFixPrompt(
  originalCode: string,
  cardSelector: string,
  containerSelector: string,
  failure: DryRunFailure,
  round: number
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `你是一个网页数据提取脚本调试专家。
一段提取脚本在实际页面执行时失败了。你需要根据执行反馈修复选择器和提取逻辑。

修复策略（按优先级）：
1. 如果选择器抛出 SyntaxError，说明 CSS 选择器语法无效，修复选择器字符串
2. 如果 querySelectorAll 返回 0 个元素，说明选择器不匹配页面 DOM，需要用更宽松或更稳定的选择器
3. 如果返回了数据但部分字段为 null，说明字段选择器在某些卡片中不存在，增强容错
4. 优先使用语义化属性（data-*, aria-*, role, name, title）替代不稳定的 class

输出要求：
1. 输出修复后的完整脚本，使用 (() => { ... })() IIFE 格式
2. IIFE 内部可以用 return 返回数组
3. 只输出代码，不要输出解释文字
4. 代码用 \`\`\`javascript 和 \`\`\` 包裹
5. 代码必须能在浏览器中通过 (0, eval)(code) 执行`

  const failureDescription =
    failure.type === "error"
      ? `执行出错：${failure.errorMessage}`
      : failure.type === "empty"
        ? `脚本执行成功但返回了空数组（0 条数据）。cardSelector "${cardSelector}" 在页面上未匹配到任何元素。`
        : `脚本返回了 ${failure.returnedData?.length || 0} 条数据，但可能不完整。`

  const domSnapshot =
    failure.firstCardHTML
      ? `\n\n当前页面第一个匹配卡片 (${cardSelector}) 的实时 HTML：
\`\`\`html
${failure.firstCardHTML}
\`\`\``
      : ""

  const sampleData =
    failure.returnedData?.length
      ? `\n\n返回数据样本（前 2 条）：
\`\`\`json
${JSON.stringify(failure.returnedData.slice(0, 2), null, 2)}
\`\`\``
      : ""

  const userPrompt = `这是第 ${round} 次自动修复尝试。

原始脚本代码：
\`\`\`javascript
${originalCode}
\`\`\`

卡片选择器：${cardSelector}
容器选择器：${containerSelector}

执行结果：${failureDescription}${domSnapshot}${sampleData}

请分析失败原因并返回修复后的完整脚本代码。`

  return { systemPrompt, userPrompt }
}

// ==================== 下一页按钮分析 Prompt ====================

export function buildNextButtonAnalysisPrompt(capture: ElementCapture): {
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
  "paginationType": "click-next | numbered | infinite-scroll | load-more",
  "pageButtonSelector": "如果是 numbered 分页，页码按钮的通用选择器，否则 null",
  "totalPagesHint": 估计总页数或 null,
  "reasoning": "选择器选择的理由（简短说明）"
}
\`\`\``

  return { systemPrompt, userPrompt }
}

// ==================== 下一页按钮分析结果解析 ====================

export interface NextButtonAnalysisResult {
  nextButtonSelector: string
  paginationType: string
  pageButtonSelector: string | null
  totalPagesHint: number | null
  reasoning: string
}

export function parseNextButtonAnalysis(response: string): NextButtonAnalysisResult {
  const text = response.trim()
  let jsonStr = text
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  const parsed = JSON.parse(jsonStr)
  return {
    nextButtonSelector: parsed.nextButtonSelector || "",
    paginationType: parsed.paginationType || "click-next",
    pageButtonSelector: parsed.pageButtonSelector || null,
    totalPagesHint: parsed.totalPagesHint || null,
    reasoning: parsed.reasoning || "",
  }
}
