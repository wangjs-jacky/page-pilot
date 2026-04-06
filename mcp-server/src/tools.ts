import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { Bridge } from "./bridge.js"

/**
 * 注册所有 MCP 工具
 */
export function registerTools(server: McpServer, bridge: Bridge) {
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
        .record(
          z.object({
            selector: z.string().describe("字段对应的 CSS 选择器"),
            attribute: z
              .enum(["textContent", "href", "src", "innerHTML", "value", "data-*"])
              .optional()
              .default("textContent")
              .describe("要提取的属性，默认 textContent"),
          })
        )
        .describe("要提取的字段映射，key 为字段名"),
    },
    async ({ containerSelector, itemSelector, fields }) => {
      const data = await bridge.sendRequest("extract_data", {
        containerSelector,
        itemSelector,
        fields,
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

  // 7. 检查连接状态
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
