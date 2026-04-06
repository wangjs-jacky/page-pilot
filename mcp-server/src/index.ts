import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Bridge } from "./bridge.js"
import { registerTools } from "./tools.js"

const BRIDGE_PORT = 9527

async function main() {
  // 创建 MCP Server
  const server = new McpServer({
    name: "page-pilot",
    version: "0.1.0",
  })

  // 创建 WebSocket Bridge
  const bridge = new Bridge(BRIDGE_PORT)

  // 注册工具
  registerTools(server, bridge)

  // 启动 MCP Server（通过 stdin/stdout 与 Claude Code 通信）
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.log("[MCP] PagePilot MCP Server 已启动")
  console.log("[MCP] 等待 Claude Code 连接...")

  // 优雅退出
  process.on("SIGINT", () => {
    console.log("\n[MCP] 正在关闭...")
    bridge.close()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    bridge.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error("[MCP] 启动失败:", err)
  process.exit(1)
})
