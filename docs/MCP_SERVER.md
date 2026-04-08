# PagePilot MCP Server 参考

PagePilot 的 MCP Server 让 Claude Code 能直接控制浏览器，完成页面导航、DOM 分析、脚本执行、结构化数据提取等操作。

## 架构概览

```
Claude Code ←→ MCP Server (stdio) ←→ Bridge (WebSocket :9527) ←→ Chrome Extension (SidePanel)
```

| 组件 | 通信方式 | 职责 |
|------|----------|------|
| Claude Code | stdin/stdout | 调用 MCP 工具 |
| MCP Server | StdioServerTransport | 解析工具调用，转发到 Bridge |
| Bridge | WebSocket Server :9527 | 双向中转：工具请求 → Extension，Extension 反向请求 → Claude CLI |
| Chrome Extension | WebSocket Client | 接收指令，操作真实页面 DOM |

### 启动流程

1. Claude Code 启动时读取 `.mcp.json`，自动 spawn `mcp-server/dist/index.js`
2. MCP Server 创建 WebSocket Server 监听端口 9527
3. 用户在 Chrome 扩展 SidePanel 中点击「连接 MCP」
4. Extension 通过 WebSocket 连接到 Bridge
5. 连接建立后，Claude Code 即可调用浏览器工具

## 注册的工具

| 工具名 | 功能 | 关键参数 |
|--------|------|----------|
| `browser_get_url` | 获取当前标签页 URL | 无 |
| `browser_get_dom` | 获取 DOM 快照（精简版） | `selector?`, `maxDepth?`, `maxLength?` |
| `browser_execute_script` | 在 MAIN world 执行 JS | `code` (必须含 return) |
| `browser_extract_data` | 批量提取结构化数据 | `containerSelector`, `itemSelector`, `fields` |
| `browser_get_text` | 获取页面纯文本 | `selector?`, `maxLength?` |
| `browser_navigate` | 导航到指定 URL | `url` |
| `browser_ping` | 检查连接状态 | 无 |

### browser_extract_data 字段定义

`fields` 是一个 Record，key 为字段名，value 包含：

| 属性 | 类型 | 说明 |
|------|------|------|
| `selector` | string | CSS 选择器（相对于 item） |
| `attribute` | enum | `textContent`（默认）/ `href` / `src` / `innerHTML` / `value` / `data-*` |

示例：

```json
{
  "containerSelector": ".video-list",
  "itemSelector": ".video-card",
  "fields": {
    "title": { "selector": ".title", "attribute": "textContent" },
    "url": { "selector": "a", "attribute": "href" },
    "cover": { "selector": "img", "attribute": "src" }
  }
}
```

## Bridge 双向通信

Bridge 不仅转发 MCP 工具调用，还支持 **Extension 反向调用 Claude CLI**。

### MCP → Extension（工具调用）

```
Claude Code → MCP Server → Bridge.sendRequest() → WebSocket → Extension
Extension → WebSocket → Bridge.handleMessage() → Promise resolve → MCP Server → Claude Code
```

消息格式：

```typescript
// 请求 (Bridge → Extension)
{ id: "req_1", tool: "browser_get_dom", args: { selector: ".list", maxDepth: 3 } }

// 响应 (Extension → Bridge)
{ id: "req_1", result: "<div class='list'>..." }
```

超时默认 30 秒。

### Extension → Claude CLI（反向请求）

```
Extension → WebSocket → Bridge.enqueueCCRequest() → spawn Claude CLI → stdout → WebSocket → Extension
```

Extension 可发送三种 action：

| action | 说明 | 超时 |
|--------|------|------|
| `list_skills` | 列出可用 skills | 30s |
| `invoke_skill` | 执行指定 skill | 120s |
| `ask_prompt` | 发送自定义 prompt | 60s |

并发上限 2 个 Claude CLI 进程，超出自动排队。

消息格式：

```typescript
// 请求 (Extension → Bridge)
{ type: "cc_request", id: "cc_1", action: "invoke_skill", skill: "my-skill", args: { key: "value" } }

// 响应 (Bridge → Extension)
{ type: "cc_response", id: "cc_1", result: { output: "...", duration: 1234 } }
```

## 项目结构

```
mcp-server/
├── src/
│   ├── index.ts      # 入口 — 创建 McpServer + Bridge，注册工具，启动 stdio 传输
│   ├── tools.ts      # 工具注册 — 7 个 browser_* 工具定义
│   └── bridge.ts     # WebSocket Bridge — 双向通信 + Claude CLI 进程管理
├── package.json      # @wangjs-jacky/page-pilot-mcp
├── tsup.config.ts    # ESM 构建，目标 Node 20
└── tsconfig.json     # TypeScript 配置
```

## 配置

### .mcp.json（项目根目录）

```json
{
  "mcpServers": {
    "page-pilot": {
      "command": "node",
      "args": ["/absolute/path/to/page-pilot/mcp-server/dist/index.js"]
    }
  }
}
```

`.claude/settings.json` 中启用：

```json
{
  "enabledMcpjsonServers": ["page-pilot"]
}
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_CLI_PATH` | `claude` | Claude CLI 可执行文件路径 |

## 开发命令

```bash
cd mcp-server

# 安装依赖
pnpm install

# 开发模式（watch）
pnpm dev

# 构建
pnpm build

# 手动启动（调试用）
pnpm start
```

## 常见问题

### 端口 9527 被占用

```
❌ Bridge 端口绑定失败
```

**原因**：其他 Claude Code 会话已启动 MCP Server。

**解决**：

```bash
# 查找占用进程
lsof -i :9527

# 终止进程
kill <PID>
```

### Extension 未连接

```
❌ Chrome Extension 未连接
```

**解决**：
1. 确认 Chrome 扩展已安装并启用
2. 打开任意页面的 SidePanel
3. 点击「连接 MCP」按钮

### 检查连接状态

在 Claude Code 中调用 `browser_ping` 工具，会返回 Bridge 端口和 Extension 连接的诊断信息。
