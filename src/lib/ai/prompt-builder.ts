import type { FieldMapping } from "../types"

const SYSTEM_PROMPT = `你是一个网页数据提取脚本生成器。你的任务是根据用户提供的 CSS 选择器列表，生成一段可以在浏览器中直接运行的 JavaScript 提取函数。

要求：
1. 生成一个自执行函数，函数内部查找页面上所有重复的列表项容器
2. 对每个容器，使用给定的 CSS 选择器提取对应字段的文本内容
3. 函数最后 return 一个 JSON 数组
4. 代码必须能在浏览器环境直接运行，不能使用任何外部库
5. 处理元素不存在的情况（对应字段返回 null）
6. 只输出代码，不要输出任何解释文字
7. 代码用 \`\`\`javascript 和 \`\`\` 包裹`

export function buildUserPrompt(fields: FieldMapping[], domContext: string): string {
  const fieldList = fields
    .map((f) => `- ${f.name}: CSS 选择器 "${f.selector}"，提取属性 ${f.attribute}`)
    .join("\n")

  return `请根据以下字段信息，生成一个网页数据提取函数。

需要提取的字段：
${fieldList}

页面 DOM 结构参考：
${domContext}

请生成提取函数，函数格式如下：
(function() {
  const results = [];
  // 找到列表容器，遍历每个列表项
  // 用给定的 CSS 选择器提取字段
  // 推入 results 数组
  return results;
})()
`
}

export function extractCodeFromResponse(response: string): string {
  // 提取 ```javascript ... ``` 中的代码
  const match = response.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/)
  if (match) return match[1].trim()
  // 如果没有代码块标记，尝试直接返回
  return response.trim()
}
