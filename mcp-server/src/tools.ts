import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { BridgeClient } from "./bridge-client.js"

/**
 * 注册所有 MCP 工具
 */
export function registerTools(server: McpServer, bridge: BridgeClient) {
  // 0. 列出脚本库
  server.tool(
    "script_list",
    "列出 Chrome 扩展中保存的所有提取脚本（id、名称、URL 匹配模式、选择器）",
    {},
    async () => {
      const scripts = await bridge.sendRequest("script_list", {})
      return { content: [{ type: "text" as const, text: JSON.stringify(scripts, null, 2) }] }
    }
  )

  // 1. 获取当前页面 URL
  server.tool(
    "browser_get_url",
    "获取当前浏览器标签页的 URL",
    {},
    async () => {
      const url = await bridge.sendRequest("get_url", {})
      return { content: [{ type: "text" as const, text: url }] }
    }
  )

  // 2. 获取页面 DOM 快照
  server.tool(
    "browser_get_dom",
    "获取当前页面的 DOM 结构快照（精简版，用于分析页面结构）",
    {
      selector: z.string().optional().describe("可选，只获取匹配该 CSS 选择器的元素的 DOM"),
      maxDepth: z.number().optional().default(5).describe("DOM 树最大深度，默认 5"),
      maxLength: z.number().optional().default(8000).describe("返回文本最大长度，默认 8000"),
    },
    async ({ selector, maxDepth, maxLength }) => {
      const dom = await bridge.sendRequest("get_dom", { selector, maxDepth, maxLength })
      return { content: [{ type: "text" as const, text: dom }] }
    }
  )

  // 3. 在页面中执行 JavaScript
  server.tool(
    "browser_execute_script",
    "在当前页面的 MAIN world 中执行 JavaScript 代码（可以访问页面的 DOM 和 JS 上下文）",
    {
      code: z.string().describe("要执行的 JavaScript 代码，必须包含 return 语句返回结果"),
    },
    async ({ code }) => {
      const result = await bridge.sendRequest("execute_script", { code })
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      }
    }
  )

  // 4. 提取结构化数据
  server.tool(
    "browser_extract_data",
    "从当前页面提取结构化数据。自动查找重复的列表项并按字段提取。",
    {
      containerSelector: z.string().describe("列表容器的 CSS 选择器"),
      itemSelector: z.string().describe("每个列表项的 CSS 选择器"),
      fields: z
        .string()
        .describe(
          '要提取的字段映射，JSON 格式。key 为字段名，value 为 { selector, attribute? }。例: {"title":{"selector":"h2"},"link":{"selector":"a","attribute":"href"}}'
        ),
    },
    async ({ containerSelector, itemSelector, fields }) => {
      const fieldsObj = JSON.parse(fields)
      const data = await bridge.sendRequest("extract_data", {
        containerSelector,
        itemSelector,
        fields: fieldsObj,
      })
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      }
    }
  )

  // 5. 获取页面文本内容
  server.tool(
    "browser_get_text",
    "获取当前页面的纯文本内容",
    {
      selector: z.string().optional().describe("可选，只获取匹配元素的文本"),
      maxLength: z.number().optional().default(5000).describe("最大返回长度"),
    },
    async ({ selector, maxLength }) => {
      const text = await bridge.sendRequest("get_text", { selector, maxLength })
      return { content: [{ type: "text" as const, text }] }
    }
  )

  // 6. 导航到指定 URL
  server.tool(
    "browser_navigate",
    "让当前标签页导航到指定 URL",
    {
      url: z.string().describe("目标 URL"),
    },
    async ({ url }) => {
      await bridge.sendRequest("navigate", { url })
      return { content: [{ type: "text" as const, text: `已导航到: ${url}` }] }
    }
  )

  // 7. 保存脚本到 Chrome 扩展
  server.tool(
    "script_save",
    "创建或更新一个提取脚本，保存到 Chrome 扩展的脚本库中。由 LLM 决定脚本名称。",
    {
      name: z.string().describe("脚本名称，由 LLM 根据用途命名，如 'Bilibili UP主视频提取'"),
      urlPatterns: z.string().describe("URL 匹配模式，逗号分隔，支持 * 通配符。如 'https://space.bilibili.com/*/upload/video'"),
      code: z.string().describe("提取脚本的 JavaScript 代码，必须包含 return 语句返回数组"),
      fields: z.string().describe("字段映射 JSON，格式: [{name, selector, attribute}]。例: [{\"name\":\"title\",\"selector\":\"h2\",\"attribute\":\"textContent\"}]"),
      cardSelector: z.string().optional().describe("卡片选择器（可选）"),
      containerSelector: z.string().optional().describe("容器选择器（可选）"),
      pagination: z.string().optional().describe("分页配置 JSON（可选）。格式: {mode:'click'|'scroll'|'url', nextButtonSelector, maxPages, waitMs}"),
      scriptId: z.string().optional().describe("更新已有脚本时传入其 ID，不传则创建新脚本"),
    },
    async ({ name, urlPatterns, code, fields, cardSelector, containerSelector, pagination, scriptId }) => {
      const fieldsArr = JSON.parse(fields)
      const urlPatternsArr = urlPatterns.split(",").map((s: string) => s.trim())
      const paginationObj = pagination ? JSON.parse(pagination) : undefined

      const result = await bridge.sendRequest("script_save", {
        scriptId,
        name,
        urlPatterns: urlPatternsArr,
        code,
        fields: fieldsArr,
        cardSelector,
        containerSelector,
        pagination: paginationObj,
      })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  // 8. 按名称或 ID 执行已保存的脚本
  server.tool(
    "script_execute",
    "执行已保存的提取脚本。可按名称或 ID 查找脚本，在当前页面执行提取。",
    {
      scriptName: z.string().optional().describe("脚本名称（模糊匹配）"),
      scriptId: z.string().optional().describe("脚本 ID（精确匹配）"),
    },
    async ({ scriptName, scriptId }) => {
      if (!scriptId && !scriptName) {
        return { content: [{ type: "text" as const, text: "错误：必须提供 scriptName 或 scriptId" }] }
      }
      const result = await bridge.sendRequest("script_execute", { scriptName, scriptId })
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      }
    }
  )

  // 9. 删除脚本
  server.tool(
    "script_delete",
    "删除已保存的提取脚本。可按名称或 ID 查找并删除。",
    {
      scriptId: z.string().optional().describe("脚本 ID（精确匹配）"),
      scriptName: z.string().optional().describe("脚本名称（模糊匹配，会删除所有匹配的脚本）"),
    },
    async ({ scriptId, scriptName }) => {
      if (!scriptId && !scriptName) {
        return { content: [{ type: "text" as const, text: "错误：必须提供 scriptName 或 scriptId" }] }
      }
      const result = await bridge.sendRequest("script_delete", { scriptId, scriptName })
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  // 10. 分页提取数据
  server.tool(
    "browser_execute_paginated",
    "分页提取数据：重复执行提取脚本直到翻页失败或达到最大页数。支持 click/numbered/scroll/url 四种翻页模式。",
    {
      code: z.string().describe("提取代码，必须包含 return 语句返回数组"),
      pagination: z.string().describe("分页配置 JSON: {mode:'click'|'numbered'|'scroll'|'url', nextButtonSelector?, pageButtonSelector?, maxPages, waitMs?}"),
    },
    async ({ code, pagination }) => {
      const paginationObj = JSON.parse(pagination)
      const result = await bridge.sendRequest("execute_paginated", {
        code,
        pagination: paginationObj,
      })
      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      }
    }
  )

  // 11. 让用户在页面上选择元素
  server.tool(
    "browser_pick_element",
    "让用户在浏览器页面上选择一个元素，返回元素的 DOM 信息（选择器、HTML、上下文等）。可用于让用户选中卡片区域或分页按钮。",
    {
      prompt: z.string().optional().describe("提示用户选什么（如'请选中分页按钮区域'）"),
    },
    async ({ prompt }) => {
      const result = await bridge.sendRequest("pick_element", { prompt }, 60_000)
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  // 12. 检查连接状态
  server.tool(
    "browser_ping",
    "检查与 Chrome Extension 的连接状态，返回 Bridge 和 Extension 的连接信息",
    {},
    async () => {
      const bridgeOk = bridge.bridgeReady
      const extOk = bridge.isConnected
      const lines = [
        `Bridge 端口绑定: ${bridgeOk ? "✅ 正常" : "❌ 失败（端口 9527 可能被占用）"}`,
        `Chrome Extension: ${extOk ? "✅ 已连接" : "❌ 未连接"}`,
      ]
      if (!bridgeOk) {
        lines.push("", "可能原因: 其他 Claude Code 会话已占用端口 9527")
        lines.push("解决方法: 关闭其他会话 或 kill 旧进程: lsof -i :9527")
      }
      if (!extOk && bridgeOk) {
        lines.push("", "请在 Chrome 扩展 SidePanel 中点击「连接 MCP」按钮")
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      }
    }
  )
}
