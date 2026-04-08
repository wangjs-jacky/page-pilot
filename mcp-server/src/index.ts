import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { BridgeClient } from "./bridge-client.js"
import { registerTools } from "./tools.js"

async function main() {
  // 创建 MCP Server
  const server = new McpServer({
    name: "page-pilot",
    version: "0.1.0",
  })

  // 创建 Bridge 客户端并连接（自动拉起 Bridge）
  const bridge = new BridgeClient()
  try {
    await bridge.connect()
  } catch {
    console.error("[MCP] Bridge 连接失败，工具调用将在 Extension 连接后可用")
  }

  // 注册工具
  registerTools(server, bridge)

  // 启动 MCP Server（通过 stdin/stdout 与 Claude Code 通信）
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error("[MCP] PagePilot MCP Server 已启动")
  console.error("[MCP] 等待 Claude Code 连接...")

  // 优雅退出
  process.on("SIGINT", () => {
    console.error("\n[MCP] 正在关闭...")
    bridge.disconnect()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    bridge.disconnect()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error("[MCP] 启动失败:", err.message || err)
  process.exit(1)
})
