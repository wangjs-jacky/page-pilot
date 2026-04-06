# PagePilot MCP Server

让 Claude Code 通过 MCP 协议控制浏览器，执行脚本、提取数据。

## 架构

```
Claude Code ←–MCP/stdio––→ MCP Server ←–WebSocket:9527––→ Chrome Extension ←–Content Script––→ 网页 DOM
```

## 安装

```bash
cd mcp-server
npm install
npm run build
```

## 配置 Claude Code

在 `~/.claude/settings.json` 或项目 `.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "page-pilot": {
      "command": "node",
      "args": ["/Users/jiashengwang/jacky-github/page-pilot/mcp-server/dist/index.js"]
    }
  }
}
```

## 使用流程

1. 在 Chrome 中安装 PagePilot 扩展（`pnpm build` 后加载 `build/chrome-mv3-prod`）
2. 打开任意网页，点击 Chrome 扩展图标打开 SidePanel
3. 在 SidePanel 中点击「连接 MCP」按钮
4. 启动 Claude Code，即可使用以下工具：

### 可用工具

| 工具 | 说明 |
|------|------|
| `browser_ping` | 检查与 Chrome Extension 的连接 |
| `browser_get_url` | 获取当前标签页 URL |
| `browser_get_dom` | 获取页面 DOM 快照（精简版） |
| `browser_execute_script` | 在页面 MAIN world 执行任意 JS |
| `browser_extract_data` | 按 CSS 选择器提取结构化数据 |
| `browser_get_text` | 获取页面文本内容 |
| `browser_navigate` | 导航到指定 URL |

### 示例：提取 B站视频列表

在 Claude Code 中直接说：

> "帮我提取当前 B站页面中所有视频的标题和播放量"

Claude Code 会自动调用 `browser_get_dom` 分析页面结构，然后调用 `browser_extract_data` 提取数据。

## 开发

```bash
npm run dev    # 监听模式
npm run build  # 构建
```
