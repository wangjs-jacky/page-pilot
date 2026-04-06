# PagePilot 架构设计

## 技术栈

| 类别 | 选型 | 说明 |
|------|------|------|
| 框架 | Plasmo v0.90.5 | Chrome 扩展开发框架，内置 HMR |
| UI | React 18 + TypeScript | 声明式组件 + 类型安全 |
| 样式 | Tailwind CSS v3 | 原子化 CSS，通过 PostCSS 集成 |
| AI SDK | @ai-sdk/openai (Vercel AI SDK) | 统一的 OpenAI 兼容接口 |
| 构建 | Parcel (Plasmo 内置) | 零配置打包 |
| 存储 | chrome.storage.local | 扩展本地存储 |
| 测试 | Vitest | 单元测试 |

## 核心场景：一键提取页面卡片列表数据

PagePilot 解决的核心问题是：**快速将网页上的重复结构化卡片批量提取为结构化数据**。

### 典型用例

> 用户在视频网站浏览，页面上有 50 张视频卡片，每张卡片包含：标题、链接、播放量、封面图、UP 主、发布时间等信息。页面底部还有分页器，可以加载更多卡片。

### 完整操作流程

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 选择代表元素                                            │
│  用户点击页面上一张视频卡片（作为"样本卡片"）                          │
│  ↓                                                               │
│  Step 2: AI 分析元素结构                                          │
│  AI 识别：这是一个可重复的卡片结构                                   │
│  自动推算：cardSelector（去掉 nth-child，匹配所有同级卡片）           │
│  自动推算：containerSelector（所有卡片的父容器）                     │
│  提取字段：标题、链接、播放量、封面、UP主、发布时间...                  │
│  ↓                                                               │
│  Step 3: 用户确认字段                                             │
│  展示 AI 识别出的所有字段，附带置信度和示例值                         │
│  用户可：启用/禁用字段、重命名字段名                                  │
│  AI 检测到分页 → 提示配置分页提取                                    │
│  ↓                                                               │
│  Step 4: 生成提取脚本                                             │
│  AI 根据确认的字段 + 选择器，生成可执行的 JavaScript 提取代码         │
│  脚本逻辑：querySelectorAll(cardSelector) → 遍历 → 提取字段 → 返回数组 │
│  ↓                                                               │
│  Step 5: 用户可预览/编辑脚本代码                                    │
│  查看生成的代码，可手动微调                                          │
│  设置 URL 匹配模式（自动填充当前站点）                                │
│  保存到脚本库                                                     │
│  ↓                                                               │
│  Step 6: 运行脚本，获取数据                                        │
│  一键执行 → 脚本在 MAIN world 运行，访问真实 DOM                     │
│  单页模式：提取当前页面所有卡片数据                                   │
│  分页模式：自动翻页 + 去重 + 汇总所有页面数据                         │
│  → 输出结构化 JSON 对象数组                                        │
│  ↓                                                               │
│  Step 7: 查看结果 + 导出                                           │
│  表格预览前 20 条、字段统计、执行耗时                                 │
│  导出：JSON / CSV / 复制到剪贴板                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计：AI 如何找到"同级元素"

这是整个产品的核心智能：

1. **用户只选一张卡片** — 不需要手动圈选所有卡片
2. **Content Script 捕获丰富上下文** — 不仅是选择器，还包括 outerHTML、parentContext、siblingCount
3. **AI 推算通用选择器** — 将 `div.video-card:nth-child(3)` 泛化为 `div.video-card`，匹配页面上所有同类卡片
4. **AI 提取卡片内字段** — 分析单张卡片的 HTML，找出有意义的子元素（标题、链接、图片等）
5. **AI 检测分页** — 根据页面结构推断是否有分页器和翻页按钮

### 脚本复用

生成的脚本会绑定 URL 匹配模式（如 `www.bilibili.com/*`）。下次用户访问同类页面时：
- Background 自动检测 URL 匹配 → 通知 SidePanel
- 用户可直接点击「执行」，无需重新选择元素

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                   │
├──────────┬──────────┬──────────┬────────────────────┤
│ Options  │SidePanel │ Content  │ Service Worker     │
│  Page    │  (Main)  │ Script   │  (Background)      │
│          │          │          │                     │
│ AI 配置  │ 视图状态机│ 元素选择 │ Tab 监听 + 消息路由 │
│          │ 脚本管理  │ 高亮     │ 脚本执行(MAIN世界) │
│          │ 结果展示  │ 选择器   │                    │
└────┬─────┴────┬─────┴────┬─────┴────────┬───────────┘
     │          │          │              │
     └──────────┴──────────┴──────────────┘
                   chrome.runtime
                   消息通信总线
```

## 模块职责

### Background (Service Worker)

**文件**: `src/background/index.ts`

| 职责 | 实现方式 |
|------|----------|
| 安装引导 | `onInstalled` → 打开 Options 页面 |
| URL 匹配检测 | `tabs.onUpdated` → 匹配脚本 → 发送 `URL_MATCHED` |
| 消息路由 | `GET_CURRENT_TAB`: 返回当前标签页信息 |
| 脚本执行 | `EXECUTE_IN_MAIN`: 在 MAIN world 执行提取代码 |

**关键设计**：脚本执行使用 `chrome.scripting.executeScript` + `world: "MAIN"`，在页面真实 DOM 环境中运行，可以访问页面的全局变量。

### SidePanel (主界面)

**文件**: `src/sidepanel/index.tsx`

采用 **视图状态机** 模式管理四个视图的切换：

```
                    ┌──────── 新建脚本 ────────┐
                    │                          ↓
library ←─── 保存 ←─ preview ←─── AI 生成 ←─ picker
   │            ↑       │                  ┌────┴────┐
   │            │       │ 直接执行          │ 选择元素 │
   │            │       ↓                  │ AI 分析  │
   │            └──── result ←────────     │ 确认字段 │
   │                     ↑                 │ 配置分页 │
   │                     │                 └─────────┘
   └── 执行已保存脚本 ────┘
```

| 视图 | 组件 | 功能 |
|------|------|------|
| library | `ScriptLibrary` | 脚本列表、匹配提示、新建/编辑/删除/执行 |
| picker | `ElementPicker` | 字段选择、AI 脚本生成 |
| preview | `ScriptPreview` | 脚本预览、编辑、保存 |
| result | `ResultView` | 数据表格、JSON/CSV 导出 |

**消息监听**：
- `URL_MATCHED` → 更新匹配脚本列表
- `ELEMENT_SELECTED` → 转发为 `CustomEvent` 给 ElementPicker

### Content Script (元素选择器)

**文件**: `src/contents/element-picker.ts`

独立运行在页面上下文中，负责：
- 鼠标悬停高亮（蓝色轮廓 + 半透明背景）
- 点击选择 → 计算 CSS 选择器
- 通过 `chrome.runtime.sendMessage` 发送选择结果

**选择器计算策略** (优先级从高到低)：
1. `#id` — 唯一 ID
2. `tag.class1.class2` — 语义化 class 组合
3. `#parentId > tag:nth-child(n) > ...` — 向上查找 ID 祖先
4. `body > tag:nth-child(n) > ...` — 完整 nth-child 路径

### Options (设置页)

**文件**: `src/options/index.tsx`

AI 服务商配置界面，管理 API Key 和模型选择。

## 核心模块

### AI 模块 (`src/lib/ai/`)

```
ai/
├── providers.ts     # 服务商注册表 (PROVIDERS + getProvider)
├── client.ts        # AI 客户端 (testConnection + generateExtractionScript)
└── prompt-builder.ts # Prompt 模板构建
```

**架构特点**：
- 所有服务商通过 `PROVIDERS` 注册表统一管理，共享 OpenAI 兼容接口
- 新增服务商只需在 `providers.ts` 添加配置 + `types.ts` 扩展类型

### 存储模块 (`src/lib/storage/`)

```
storage/
├── settings.ts   # 用户设置 (AI 配置)
└── scripts.ts    # 提取脚本 (CRUD + URL 匹配)
```

基于 `chrome.storage.local` 的异步存储。

### 选择器模块 (`src/lib/selector/`)

```
selector/
└── calculator.ts  # 服务端选择器计算 (Content Script 中有独立实现)
```

### 导出模块 (`src/lib/export/`)

```
export/
└── index.ts  # JSON/CSV 序列化 + 下载 + 剪贴板
```

## 消息协议

所有模块间通信通过 `chrome.runtime` 消息总线：

| 消息类型 | 发送方 | 接收方 | 说明 |
|----------|--------|--------|------|
| `START_PICKER` | SidePanel → Content | Content Script | 启动元素选择 |
| `STOP_PICKER` | SidePanel → Content | Content Script | 停止元素选择 |
| `ELEMENT_SELECTED` | Content Script | SidePanel | 元素选择结果 |
| `EXECUTE_IN_MAIN` | SidePanel → Background | Background | 在 MAIN world 执行代码 |
| `SCRIPT_RESULT` | Content Script | SidePanel | 脚本执行结果 |
| `URL_MATCHED` | Background | SidePanel | URL 匹配通知 |
| `GET_CURRENT_TAB` | SidePanel → Background | Background | 获取当前标签页 |

## 数据类型 (`src/lib/types.ts`)

| 类型 | 用途 |
|------|------|
| `ExtractionScript` | 提取脚本（id、名称、URL 模式、字段映射、代码） |
| `FieldMapping` | 字段映射（名称、选择器、属性） |
| `AIProviderConfig` | AI 服务商配置（服务商 ID、Key、模型） |
| `Settings` | 用户设置（包裹 AI 配置） |
| `ExtractionResult` | 提取结果（脚本 ID、数据、耗时） |
| `ViewState` | 视图状态（联合类型，驱动状态机） |

## Manifest V3 权限

```json
{
  "permissions": ["storage", "activeTab", "scripting", "sidePanel", "tabs"],
  "host_permissions": ["<all_urls>"]
}
```

| 权限 | 用途 |
|------|------|
| `storage` | 保存用户设置和脚本 |
| `activeTab` | 访问当前标签页 |
| `scripting` | `executeScript` 在 MAIN world 运行 |
| `sidePanel` | 侧边栏 UI |
| `tabs` | 监听标签页 URL 变化 |
| `<all_urls>` | 在任意页面注入 Content Script |

## AI 服务商

| 服务商 | Base URL | 默认模型 |
|--------|----------|----------|
| 本地 (Ollama) | `localhost:11434/v1` | qwen2.5 |
| Kimi (月之暗面) | `api.moonshot.cn/v1` | moonshot-v1-auto |
| 智谱 (GLM) | `open.bigmodel.cn/api/paas/v4` | glm-4-flash |
| DeepSeek (默认) | `api.deepseek.com/v1` | deepseek-chat |
| OpenRouter | `openrouter.ai/api/v1` | claude-3.5-sonnet |

所有服务商共享 OpenAI 兼容接口，通过 `PROVIDERS` 注册表扩展。
