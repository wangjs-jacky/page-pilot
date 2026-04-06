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
8. 用 \`\`\`json 和 \`\`\` 包裹 JSON`

  const userPrompt = `分析以下页面元素：

元素标签：${capture.tagName}
选择器：${capture.selector}
同级同类元素数量：${capture.siblingCount}
父容器结构：${capture.parentContext}

元素 HTML：
\`\`\`html
${capture.outerHTML}
\`\`\`

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
    "nextButtonSelector": "下一页按钮的选择器或 null",
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
根据用户提供的字段信息和选择器，生成一段可以在浏览器 MAIN world 中直接运行的 JavaScript 提取函数。

关键要求：
1. 使用 querySelectorAll 找到页面上所有匹配的卡片元素
2. 对每个卡片，使用字段选择器（相对于卡片）提取对应数据
3. 数字字段需清洗：去除 "万"、"、"等，"1.8万" 转 18000
4. 链接字段补全为完整 URL（补 https: 前缀如果缺失）
5. 函数最后 return 一个 JSON 数组
6. 代码必须能在浏览器环境直接运行，不使用任何外部库
7. 处理元素不存在的情况（对应字段返回 null）
8. 只输出代码，不要输出解释文字
9. 代码用 \`\`\`javascript 和 \`\`\` 包裹
10. 如果需要分页（async IIFE），使用 await + Promise 处理异步等待，不要使用回调
11. 调用 querySelector 前必须检查选择器是否为有效非空字符串。空字符串传给 querySelector 会抛 SyntaxError，应视为"没有下一页"并 break`

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
  return `请根据以下字段信息，生成网页数据提取函数。

卡片选择器：${cardSelector}
容器选择器：${containerSelector}

需要提取的字段：
${fieldList}

函数格式：
(function() {
  const results = [];
  // 使用容器选择器 + 卡片选择器找到所有卡片
  // 遍历每个卡片，提取字段
  // 推入 results 数组
  return results;
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
  const modeInstruction =
    pagination.mode === "click"
      ? `翻页方式：点击下一页按钮
  - 下一页按钮选择器：${pagination.nextButtonSelector || '（未提供）'}
  - **重要**：调用 document.querySelector() 前必须先检查选择器是否为非空字符串，空字符串会抛 SyntaxError
  - 如果选择器为空、按钮不存在或 disabled，终止循环
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

  return `请根据以下字段信息，生成一个带分页循环的异步网页数据提取函数。

卡片选择器：${cardSelector}
容器选择器：${containerSelector}

需要提取的字段：
${fieldList}

分页配置：
${modeInstruction}
最大页数：${pagination.maxPages}

去重规则：每页提取后，比较第一条数据的 JSON 签名（JSON.stringify），如果与上一页第一条相同，说明翻页没生效，立即终止。

函数格式（必须是 async IIFE）：
(async function() {
  const results = [];
  let previousSignature = '';
  for (let page = 1; page <= ${pagination.maxPages}; page++) {
    // 1. 提取当前页所有卡片数据
    // 2. 如果 page > 1 且有数据，做去重检查
    // 3. 将本页数据推入 results
    // 4. 如果不是最后一页，执行翻页动作并等待
    //    ${pagination.mode === "click" ? '找到下一页按钮并点击，如果不存在则 break' : ""}
    //    ${pagination.mode === "scroll" ? "滚动到底部" : ""}
    //    await new Promise(r => setTimeout(r, ${pagination.waitMs}));
  }
  return results;
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
4. 分页修复 — 翻页逻辑失败、重复数据等
5. 容错增强 — 处理动态加载、延迟渲染、元素不存在等情况
6. 性能优化 — 减少 DOM 查询、优化遍历逻辑

输出要求：
1. 输出优化后的完整脚本，保持原有结构（IIFE 或 async IIFE）
2. 只输出代码，不要输出解释文字
3. 代码用 \`\`\`javascript 和 \`\`\` 包裹
4. 代码必须能在浏览器 MAIN world 直接运行`

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
