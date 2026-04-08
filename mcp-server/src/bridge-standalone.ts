/**
 * Bridge 独立进程入口
 * 由 MCP Server 自动拉起，或手动启动: node dist/bridge-standalone.js
 */
import { BridgeServer } from "./bridge-server.js"

const bridge = new BridgeServer()

// 优雅退出
process.on("SIGINT", () => {
  console.log("\n[Bridge] 正在关闭...")
  bridge.close()
  process.exit(0)
})

process.on("SIGTERM", () => {
  bridge.close()
  process.exit(0)
})
