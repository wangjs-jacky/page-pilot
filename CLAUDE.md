# PagePilot - 高效浏览器自动化 Chrome 扩展

## PagePilot 解决什么问题

现有的浏览器自动化工具（browser-use、agent-browser、chrome-devtools MCP）都面临同一个问题：**太慢了**。每次操作都要截图→AI 理解→执行→再截图验证，一个简单的翻页提取可能要几分钟。

PagePilot 的核心思路：**预调试好的脚本 + 桥接模式 = 秒级执行**。

### 与传统方案的对比

| 维度 | browser-use / agent-browser | PagePilot |
|------|---------------------------|-----------|
| 执行速度 | 慢（每步需 AI 推理 + 截图） | 快（预调试脚本直接跑） |
| 交互方式 | 每步都走 AI | AI 只在"创作脚本"阶段参与 |
| 稳定性 | 依赖实时视觉理解，易出错 | 选择器固定，结果可复现 |
| 复用性 | 不可复用，每次重新推理 | 脚本保存后可反复执行 |
| 成本 | 高（大量 AI 调用） | 低（脚本创建用一次 AI） |

## 工作方式

PagePilot 有两条使用路径：

### 路径一：Chrome 扩展 UI（人工操作）

```
选择页面元素 → AI 分析结构 → 生成提取脚本 → 预览/编辑 → 保存到脚本库 → 一键执行
```

用户在 SidePanel 中点击页面卡片，AI 自动识别同类卡片结构、提取字段、生成 JavaScript 提取代码。保存后的脚本绑定 URL 模式，下次访问同类页面可直接执行。

### 路径二：MCP 桥接模式（Claude Code 驱动）

```
Claude Code → MCP Server (stdio) → Bridge (WebSocket :9527) → Chrome Extension → 页面 DOM
```

这是 PagePilot 的核心差异化能力。Claude Code 通过 MCP Server 直接操控浏览器：

1. **桥接连接**：MCP Server 通过 WebSocket 连接到 Chrome 扩展，扩展在真实页面 DOM 中执行操作
2. **脚本回显**：扩展执行脚本后，结果通过 Bridge 回传给 Claude Code 的终端
3. **预调试脚本**：脚本事先在 Console 中调试验证过，执行时直接注入 `MAIN world`，无需截图和 AI 推理

典型场景：Claude Code 需要抓取某个网页的数据 → 调用 `browser_extract_data` → 扩展在页面中执行提取 → 结构化数据秒级返回到终端。

## 技术栈

Plasmo v0.90.5 + React 18 + TypeScript + Tailwind CSS v3 + Vercel AI SDK

## 核心架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Chrome Extension                       │
├──────────┬──────────┬──────────┬──────────────────────────────┤
│ Options  │SidePanel │ Content  │ Service Worker (Background)  │
│          │  (Main)  │ Script   │                              │
│ AI 配置  │ 视图状态机│ 元素选择 │ Tab 监听 + 消息路由           │
│          │ 脚本管理  │ 高亮     │ 脚本执行 (MAIN world)        │
│          │ MCP 连接  │ 选择器   │                              │
└──────────┴────┬─────┴────┬─────┴──────────────────────────────┘
               │          │              │
               └──────────┴──────────────┘
                  chrome.runtime 消息通信总线
                         ↕ WebSocket :9527
               ┌─────────────────────┐
               │ MCP Server (stdio)  │
               │ Bridge + Tools      │
               └────────┬────────────┘
                        ↕ stdin/stdout
                  Claude Code 终端
```

- **SidePanel** — 视图状态机驱动六个视图切换 (library → picker → preview → result / claude-code → claude-code-result)
- **Background** — Tab 监听 + 消息路由 + MAIN world 脚本执行
- **Content Script** — 元素选择器（高亮 + CSS 选择器计算 + 富 DOM 捕获）
- **AI 模块** — OpenAI 兼容接口，服务商通过 `PROVIDERS` 注册表统一管理
- **MCP Server** — 7 个 `browser_*` 工具 + Bridge 双向通信 + Claude CLI 反向调用
- **存储** — `chrome.storage.local`，分 settings 和 scripts 两层

## 消息协议

| 消息 | 方向 | 说明 |
|------|------|------|
| `START_PICKER` / `STOP_PICKER` | SidePanel → Content | 控制元素选择 |
| `ELEMENT_SELECTED` | Content → SidePanel | 选择结果（含富 DOM 上下文） |
| `EXECUTE_IN_MAIN` | SidePanel → Background | 在 MAIN world 执行代码 |
| `EXECUTE_PAGINATED` | SidePanel → Background | 分页模式执行 |
| `PAGINATED_PROGRESS` | Background → SidePanel | 分页进度通知 |
| `URL_MATCHED` | Background → SidePanel | URL 匹配通知 |

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/sidepanel/index.tsx` | 视图状态机入口 |
| `src/background/index.ts` | Service Worker |
| `src/contents/element-picker.ts` | Content Script 元素选择 |
| `src/lib/ai/providers.ts` | AI 服务商注册表 |
| `src/lib/ai/client.ts` | AI 客户端 |
| `src/lib/types.ts` | 全局类型定义 |
| `src/lib/storage/` | 存储层 (settings + scripts) |
| `mcp-server/src/index.ts` | MCP Server 入口 |
| `mcp-server/src/bridge-server.ts` | Bridge WebSocket 服务 |

## 开发规范

- **先写测试，再修 Bug**：遇到 Bug 时，必须先补充能复现问题的测试 case，测试通过后再修复代码。修复的衡量标准是测试 case 全部通过，而非手动验证。

## 开发命令

```bash
pnpm install   # 安装依赖
pnpm dev       # 开发模式
pnpm build     # 生产构建
pnpm test      # 运行测试

cd mcp-server
pnpm dev       # MCP Server 开发模式 (watch)
pnpm build     # MCP Server 构建
```

## Design（设计备忘录）

> 记录各种设计想法和讨论，不一定反映当前实现。

### 脚本架构：单页提取 vs 全量封装

**方案 A：单页提取 + 外部翻页循环（当前方案）**

```
脚本 = 纯同步 IIFE，只提取当前页数据
分页 = Background / MCP 驱动外部循环（点击下一页 → 执行脚本 → 再点击 → ...）
```

优点：
- 脚本轻量、简单、同步，兼容 `(0, eval)(code)` 间接 eval
- 翻页逻辑由运行时统一处理（去重、超时、进度通知）
- 脚本只关心"提取数据"这一件事

缺点：
- 脚本和分页配置分离，不能单独分享一个"完整脚本"
- 分页行为依赖外部系统理解配置

**方案 B：全量封装的异步脚本**

```
脚本 = async IIFE，内含翻页循环 + 数据收集 + 去重
```

优点：
- 一个脚本 = 一个完整任务，自包含可分享
- MCP 只需一次 `browser_execute_script` 就能跑完

缺点：
- `chrome.scripting.executeScript` 不等待 Promise resolve，async 脚本返回的是 Promise 对象而非数据
- 脚本更重，调试更难
- 翻页失败/超时的容错逻辑要写在每个脚本里

**结论**：方案 A 更稳健。`chrome.scripting.executeScript` + `(0, eval)` 的技术限制使得 async 脚本不可靠。外部翻页循环是更清晰的关注点分离。

### MCP ↔ 扩展 双向交互协议

**愿景**：Claude Code 通过 MCP 触发扩展的交互功能，用户在页面上操作后，结果回传给 CC。

```
CC: browser_pick_element({ prompt: "请选中分页按钮区域" })
  → MCP Server → Bridge → Extension
  → Extension 启动元素选择器，高亮页面
  → 用户点击选择分页区（如 1,2,3,4,5,6,7 按钮组）
  → Extension 捕获 ElementCapture
  → Extension → Bridge → MCP Server → CC
  → CC 拿到选择结果，生成/优化脚本
```

**实现方案**：

1. MCP 侧新增 `browser_pick_element` 工具，发送 `pick_element` 请求到 Extension
2. Extension 收到后通过 `chrome.tabs.sendMessage` 让 Content Script 启动选择器
3. 用户在页面上选择元素后，Content Script 回传 `ElementCapture`
4. Extension 将 `ElementCapture` 通过 Bridge 回传给 MCP
5. MCP 工具返回选择结果给 CC

**关键技术点**：
- MCP 工具需要长时间等待（用户操作需要时间），timeout 设为 60s+
- Bridge 已有 `tool_call → tool_response` 的请求-响应路由，天然支持这种模式
- Content Script 的元素选择器已实现，只需加一个从 MCP 触发的入口

### 分页元素选择：两种模式

**模式 1：选"下一页"按钮**
- 用户选一个按钮（如 B 站的"下一页"）
- 系统点击这个按钮 N 次

**模式 2：选分页区域**
- 用户选中整个分页区（如 B 站的 `1 2 3 4 5 6 7` 按钮组）
- AI 分析分页结构，识别：总页数、当前页、按钮通用选择器
- 系统可以逐页点击或直接跳到指定页

模式 2 更灵活（可以直接跳第 5 页），模式 1 更简单。可以都支持，让用户选择。

### 端到端理想工作流

```
1. 用户在 Chrome 扩展中：
   - 选卡片区 → AI 分析字段 → 生成初版脚本
   - 选分页区 → AI 识别翻页模式 → 生成分页配置

2. 初版脚本可能不完美，保存到脚本库

3. Claude Code 通过 MCP：
   - script_list 查看脚本
   - script_execute 执行验证
   - browser_execute_script 调试选择器
   - script_save 保存优化后的版本

4. 下次访问同类型页面：
   - URL 自动匹配 → 一键执行 → 全量数据秒级返回
```

## Reference

- [架构设计](docs/ARCHITECTURE.md) — 模块职责、数据流、消息协议、Manifest 权限的完整说明
- [开发指南](docs/DEVELOPMENT.md) — 项目结构、API 参考、添加服务商、测试、发布流程
- [MCP Server](docs/MCP_SERVER.md) — MCP 工具列表、Bridge 双向通信、配置与常见问题
