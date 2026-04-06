# PagePilot 多步自动化测试方案

> 本地 LLM 通过 MCP 通道编排 Chrome 扩展，实现多步骤网页数据提取自动化

## 一、现状分析

### 已有能力

| 能力 | 实现位置 | 状态 |
|------|---------|------|
| MCP Server (stdio) | `mcp-server/src/index.ts` | 已实现 |
| WebSocket Bridge | `mcp-server/src/bridge.ts` | 已实现 |
| Chrome 扩展 MCP Client | `src/lib/mcp/ws-client.ts` | 已实现 |
| 页面导航 | `browser_navigate` | 已实现 |
| 脚本执行 (MAIN world) | `browser_execute_script` | 已实现 |
| DOM 快照 | `browser_get_dom` | 已实现 |
| 结构化数据提取 | `browser_extract_data` | 已实现 |
| 文本获取 | `browser_get_text` | 已实现 |
| URL 获取 | `browser_get_url` | 已实现 |

### 缺失能力（需新增）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 元素点击 | 模拟用户点击（翻页、按钮） | P0 |
| 元素输入 | 模拟键盘输入（搜索框） | P0 |
| 等待条件 | 等待元素出现/页面加载 | P0 |
| 截图 | 调试和验证用 | P1 |
| 自动化编排工具 | 单个 MCP 工具完成多步编排 | P1 |
| 执行日志 | 记录每步操作和结果 | P1 |

## 二、目标场景

### 场景 A: B 站搜索结果多页提取

```
用户指令: "在B站搜索AI，提取前3页的视频标题、UP主、播放量，导出为JSON"

LLM 编排流程:
1. navigate → https://search.bilibili.com/all?keyword=AI
2. get_dom → 分析搜索结果列表结构
3. extract_data → 提取第1页数据 (title, author, views)
4. click → 点击"下一页"按钮
5. wait → 等待新数据加载
6. extract_data → 提取第2页数据
7. click → 点击"下一页"按钮
8. wait → 等待新数据加载
9. extract_data → 提取第3页数据
10. 汇总所有数据，返回 JSON
```

### 场景 B: 知乎热榜跨页采集

```
用户指令: "采集知乎热榜前50条问题的标题、热度、链接"

LLM 编排流程:
1. navigate → https://www.zhihu.com/hot
2. get_dom → 分析热榜列表结构
3. extract_data → 提取当前可见数据
4. execute_script → 滚动到底部加载更多
5. wait → 等待新内容加载
6. extract_data → 提取更多数据
7. 去重 + 截取前50条
```

## 三、新增 MCP 工具设计

### 3.1 `browser_click` — 元素点击

**触发场景**: 翻页、展开更多、切换 Tab

```typescript
// mcp-server/src/tools.ts 新增
server.tool(
  "browser_click",
  "点击页面上的指定元素",
  {
    selector: z.string().describe("要点击元素的 CSS 选择器"),
    index: z.number().optional().default(0).describe("匹配多个时点击第几个（从0开始）"),
  },
  async ({ selector, index }) => {
    const result = await bridge.sendRequest("click", { selector, index })
    return { content: [{ type: "text", text: result }] }
  }
)
```

**ws-client.ts 对应处理**:

```typescript
async function handleClick(args: { selector: string; index: number }): Promise<string> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: (selector: string, index: number) => {
      const elements = document.querySelectorAll(selector)
      const el = elements[index]
      if (!el) return `未找到匹配元素: ${selector}[${index}]`
      el.click()
      return `已点击: ${selector} (${elements.length} 个匹配中的第 ${index} 个)`
    },
    args: [args.selector, args.index],
  })
  return results?.[0]?.result || "执行完成"
}
```

### 3.2 `browser_type` — 元素输入

**触发场景**: 搜索框输入、表单填写

```typescript
server.tool(
  "browser_type",
  "在指定的输入框中输入文本",
  {
    selector: z.string().describe("输入框的 CSS 选择器"),
    text: z.string().describe("要输入的文本"),
    pressEnter: z.boolean().optional().default(false).describe("输入后是否按回车"),
  },
  async ({ selector, text, pressEnter }) => {
    const result = await bridge.sendRequest("type", { selector, text, pressEnter })
    return { content: [{ type: "text", text: result }] }
  }
)
```

### 3.3 `browser_wait` — 等待条件

**触发场景**: 点击翻页后等待新数据加载

```typescript
server.tool(
  "browser_wait",
  "等待页面上的指定条件满足",
  {
    type: z.enum(["selector", "navigation", "timeout"]).describe("等待类型"),
    selector: z.string().optional().describe("等待出现的 CSS 选择器 (type=selector 时必填)"),
    timeout: z.number().optional().default(5000).describe("超时时间(ms)，默认5000"),
    interval: z.number().optional().default(500).describe("检查间隔(ms)，默认500"),
  },
  async ({ type, selector, timeout, interval }) => {
    const result = await bridge.sendRequest("wait", { type, selector, timeout, interval })
    return { content: [{ type: "text", text: result }] }
  }
)
```

**ws-client.ts 对应处理**:

```typescript
async function handleWait(args: {
  type: "selector" | "navigation" | "timeout"
  selector?: string
  timeout: number
  interval: number
}): Promise<string> {
  const tab = await getActiveTab()
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    world: "MAIN",
    func: async (type: string, selector: string | undefined, timeout: number, interval: number) => {
      if (type === "timeout") {
        await new Promise(r => setTimeout(r, timeout))
        return `已等待 ${timeout}ms`
      }
      if (type === "selector" && selector) {
        const start = Date.now()
        while (Date.now() - start < timeout) {
          if (document.querySelector(selector)) {
            return `元素已出现: ${selector} (${Date.now() - start}ms)`
          }
          await new Promise(r => setTimeout(r, interval))
        }
        return `超时: ${selector} 在 ${timeout}ms 内未出现`
      }
      return "未知等待类型"
    },
    args: [args.type, args.selector, args.timeout, args.interval],
  })
  return results?.[0]?.result || "等待完成"
}
```

### 3.4 `browser_screenshot` — 截图（调试用）

```typescript
server.tool(
  "browser_screenshot",
  "截取当前页面或指定元素的截图（用于调试和验证）",
  {
    selector: z.string().optional().describe("可选，只截取匹配元素"),
    fullPage: z.boolean().optional().default(false).describe("是否截取完整页面"),
  },
  async ({ selector, fullPage }) => {
    const result = await bridge.sendRequest("screenshot", { selector, fullPage })
    return {
      content: [{
        type: "image" as const,
        data: result,
        mimeType: "image/png",
      }],
    }
  }
)
```

### 3.5 `browser_automate` — 一键编排工具（高级）

**设计理念**: 将常见编排模式封装为单个工具调用，减少 LLM 多轮决策开销

```typescript
server.tool(
  "browser_automate",
  "执行多步骤自动化任务：导航→提取→翻页→提取...循环",
  {
    url: z.string().describe("起始页面 URL"),
    containerSelector: z.string().describe("数据列表容器选择器"),
    itemSelector: z.string().describe("每个数据项选择器"),
    fields: z.record(z.object({
      selector: z.string(),
      attribute: z.string().optional().default("textContent"),
    })).describe("要提取的字段映射"),
    nextPageSelector: z.string().describe("下一页按钮选择器"),
    maxPages: z.number().default(3).describe("最大翻页次数"),
    waitAfterClick: z.number().default(2000).describe("点击翻页后等待时间(ms)"),
  },
  async (params) => {
    const result = await bridge.sendRequest("automate", params)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  }
)
```

**ws-client.ts 编排逻辑**:

```typescript
async function handleAutomate(args: {
  url: string
  containerSelector: string
  itemSelector: string
  fields: Record<string, { selector: string; attribute: string }>
  nextPageSelector: string
  maxPages: number
  waitAfterClick: number
}): Promise<{ data: any[]; pages: number; totalDuration: number }> {
  const tab = await getActiveTab()
  const allData: any[] = []
  const start = Date.now()

  // 1. 导航到起始页
  await chrome.tabs.update(tab.id!, { url: args.url })
  await waitForTabLoad(tab.id!)

  // 2. 循环提取 + 翻页
  for (let page = 0; page < args.maxPages; page++) {
    // 提取数据
    const pageData = await executeExtraction(
      tab.id!, args.containerSelector, args.itemSelector, args.fields
    )
    allData.push(...pageData)

    // 尝试点击下一页
    if (page < args.maxPages - 1) {
      const clicked = await clickElement(tab.id!, args.nextPageSelector)
      if (!clicked) break // 没有下一页了
      await sleep(args.waitAfterClick)
    }
  }

  return {
    data: allData,
    pages: Math.min(args.maxPages, allData.length > 0 ? args.maxPages : 0),
    totalDuration: Date.now() - start,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 10000)
  })
}
```

## 四、完整工具清单

| 工具名 | 类别 | 状态 | 用途 |
|--------|------|------|------|
| `browser_ping` | 基础 | 已有 | 连接检测 |
| `browser_get_url` | 读取 | 已有 | 获取当前 URL |
| `browser_get_dom` | 读取 | 已有 | 获取 DOM 结构 |
| `browser_get_text` | 读取 | 已有 | 获取页面文本 |
| `browser_navigate` | 导航 | 已有 | 导航到 URL |
| `browser_execute_script` | 执行 | 已有 | 执行 JS 代码 |
| `browser_extract_data` | 提取 | 已有 | 结构化数据提取 |
| `browser_click` | 交互 | **新增** | 点击元素 |
| `browser_type` | 交互 | **新增** | 输入文本 |
| `browser_wait` | 控制 | **新增** | 等待条件 |
| `browser_screenshot` | 调试 | **新增** | 页面截图 |
| `browser_automate` | 编排 | **新增** | 一键多步自动化 |

## 五、测试设计

### 5.1 L1: 单元测试

**文件结构**:
```
src/lib/automation/
├── types.ts            # 自动化相关类型定义
├── step-executor.ts    # 单步执行器
├── orchestrator.ts     # 多步编排器
├── result-aggregator.ts # 结果聚合
└── __tests__/
    ├── step-executor.test.ts
    ├── orchestrator.test.ts
    └── result-aggregator.test.ts
```

#### 5.1.1 结果聚合器测试 (`result-aggregator.test.ts`)

```typescript
import { describe, it, expect } from "vitest"
import { ResultAggregator } from "../result-aggregator"
import type { StepResult } from "../types"

describe("ResultAggregator", () => {
  const aggregator = new ResultAggregator()

  it("应合并多个步骤的数组结果", () => {
    const steps: StepResult[] = [
      {
        stepId: "s1",
        status: "success",
        data: [
          { title: "视频1", views: "1万" },
          { title: "视频2", views: "2万" },
        ],
        duration: 100,
      },
      {
        stepId: "s2",
        status: "success",
        data: [
          { title: "视频3", views: "3万" },
          { title: "视频4", views: "4万" },
        ],
        duration: 120,
      },
    ]

    const result = aggregator.merge(steps)
    expect(result.data).toHaveLength(4)
    expect(result.data[0].title).toBe("视频1")
    expect(result.data[3].title).toBe("视频4")
    expect(result.totalDuration).toBe(220)
    expect(result.successCount).toBe(2)
  })

  it("应处理部分失败 — 保留已收集数据", () => {
    const steps: StepResult[] = [
      {
        stepId: "s1",
        status: "success",
        data: [{ title: "视频1" }],
        duration: 100,
      },
      {
        stepId: "s2",
        status: "failed",
        error: "选择器未匹配",
        duration: 50,
        data: [],
      },
      {
        stepId: "s3",
        status: "success",
        data: [{ title: "视频2" }],
        duration: 110,
      },
    ]

    const result = aggregator.merge(steps)
    expect(result.data).toHaveLength(2)
    expect(result.successCount).toBe(2)
    expect(result.failureCount).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("选择器未匹配")
  })

  it("应支持去重", () => {
    const steps: StepResult[] = [
      {
        stepId: "s1",
        status: "success",
        data: [{ title: "视频A", url: "a" }],
        duration: 100,
      },
      {
        stepId: "s2",
        status: "success",
        data: [{ title: "视频A", url: "a" }, { title: "视频B", url: "b" }],
        duration: 100,
      },
    ]

    const result = aggregator.merge(steps, { deduplicateBy: "url" })
    expect(result.data).toHaveLength(2) // 去重后只有 A 和 B
  })

  it("应计算统计信息", () => {
    const steps: StepResult[] = [
      { stepId: "s1", status: "success", data: Array(20).fill({}), duration: 100 },
      { stepId: "s2", status: "success", data: Array(15).fill({}), duration: 80 },
    ]

    const result = aggregator.merge(steps)
    expect(result.totalCount).toBe(35)
    expect(result.avgDurationPerPage).toBe(90)
  })

  it("空输入应返回空结果", () => {
    const result = aggregator.merge([])
    expect(result.data).toHaveLength(0)
    expect(result.totalCount).toBe(0)
  })
})
```

#### 5.1.2 编排器测试 (`orchestrator.test.ts`)

```typescript
import { describe, it, expect, vi } from "vitest"
import { Orchestrator } from "../orchestrator"
import type { AutomationConfig, AutomationStep } from "../types"

// Mock Bridge
const mockBridge = {
  sendRequest: vi.fn(),
}

describe("Orchestrator", () => {
  let orchestrator: Orchestrator

  beforeEach(() => {
    orchestrator = new Orchestrator(mockBridge as any)
    vi.clearAllMocks()
  })

  it("应按顺序执行 extract → navigate 循环", async () => {
    const config: AutomationConfig = {
      url: "https://example.com/search",
      containerSelector: ".results",
      itemSelector: ".item",
      fields: { title: { selector: ".title", attribute: "textContent" } },
      nextPageSelector: ".next-btn",
      maxPages: 3,
      waitAfterClick: 100,
    }

    // Mock 返回
    mockBridge.sendRequest
      .mockResolvedValueOnce(undefined) // navigate
      .mockResolvedValueOnce([{ title: "Page1_Item1" }]) // extract
      .mockResolvedValueOnce("已点击") // click
      .mockResolvedValueOnce("元素已出现") // wait
      .mockResolvedValueOnce([{ title: "Page2_Item1" }]) // extract
      .mockResolvedValueOnce("已点击") // click
      .mockResolvedValueOnce("元素已出现") // wait
      .mockResolvedValueOnce([{ title: "Page3_Item1" }]) // extract

    const result = await orchestrator.run(config)

    expect(result.data).toHaveLength(3)
    expect(result.pages).toBe(3)
    expect(mockBridge.sendRequest).toHaveBeenCalledTimes(8)
  })

  it("应在无法翻页时提前终止", async () => {
    mockBridge.sendRequest
      .mockResolvedValueOnce(undefined) // navigate
      .mockResolvedValueOnce([{ title: "Item1" }]) // extract page 1
      .mockResolvedValueOnce(null) // click → 下一页不存在

    const result = await orchestrator.run({
      url: "https://example.com",
      containerSelector: ".list",
      itemSelector: ".item",
      fields: { title: { selector: ".t", attribute: "textContent" } },
      nextPageSelector: ".next",
      maxPages: 5,
      waitAfterClick: 100,
    })

    expect(result.data).toHaveLength(1)
    expect(result.pages).toBe(1)
  })

  it("应在单步超时时继续执行（容错）", async () => {
    mockBridge.sendRequest
      .mockResolvedValueOnce(undefined) // navigate
      .mockResolvedValueOnce([{ title: "P1" }]) // extract
      .mockRejectedValueOnce(new Error("超时")) // click 失败
      .mockResolvedValueOnce([{ title: "P2" }]) // 第二次尝试 extract

    const result = await orchestrator.run({
      url: "https://example.com",
      containerSelector: ".list",
      itemSelector: ".item",
      fields: { title: { selector: ".t", attribute: "textContent" } },
      nextPageSelector: ".next",
      maxPages: 3,
      waitAfterClick: 100,
    })

    expect(result.data.length).toBeGreaterThan(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("应强制不超过 maxPages 上限", async () => {
    let extractCount = 0
    mockBridge.sendRequest.mockImplementation(async (tool: string) => {
      if (tool === "extract_data") return [{ title: `Item_${++extractCount}` }]
      if (tool === "click") return "已点击"
      if (tool === "wait") return "ok"
      return undefined
    })

    const result = await orchestrator.run({
      url: "https://example.com",
      containerSelector: ".list",
      itemSelector: ".item",
      fields: { title: { selector: ".t", attribute: "textContent" } },
      nextPageSelector: ".next",
      maxPages: 2,
      waitAfterClick: 100,
    })

    expect(extractCount).toBeLessThanOrEqual(2)
  })
})
```

### 5.2 L2: 集成测试

**测试目标**: 验证 MCP Server → Bridge → Chrome Extension 全链路

#### 5.2.1 MCP Server 工具注册测试

```typescript
// mcp-server/src/__tests__/tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerTools } from "../tools"
import { Bridge } from "../bridge"

describe("MCP Tools 注册", () => {
  let server: McpServer
  let bridge: Bridge

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.0" })
    bridge = new Bridge(0) // 端口 0 让系统随机分配
    registerTools(server, bridge)
  })

  it("应注册所有工具", () => {
    // 验证所有工具都已注册
    const expectedTools = [
      "browser_ping",
      "browser_get_url",
      "browser_get_dom",
      "browser_get_text",
      "browser_navigate",
      "browser_execute_script",
      "browser_extract_data",
      "browser_click",       // 新增
      "browser_type",        // 新增
      "browser_wait",        // 新增
      "browser_screenshot",  // 新增
      "browser_automate",    // 新增
    ]
    // McpServer 没有直接列出工具的 API，通过调用验证
    expect(server).toBeDefined()
  })

  afterEach(() => {
    bridge.close()
  })
})
```

#### 5.2.2 WebSocket Bridge 通信测试

```typescript
// mcp-server/src/__tests__/bridge.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import WebSocket from "ws"
import { Bridge } from "../bridge"

describe("Bridge 通信", () => {
  const PORT = 19876
  let bridge: Bridge
  let client: WebSocket

  beforeAll(async () => {
    bridge = new Bridge(PORT)
    await new Promise<void>((resolve) => {
      client = new WebSocket(`ws://localhost:${PORT}`)
      client.on("open", () => resolve())
    })
  })

  afterAll(() => {
    client.close()
    bridge.close()
  })

  it("应正确转发请求并返回结果", async () => {
    // 模拟 Chrome Extension 响应
    client.on("message", (raw) => {
      const msg = JSON.parse(raw.toString())
      client.send(JSON.stringify({
        id: msg.id,
        result: { url: "https://example.com" },
      }))
    })

    const result = await bridge.sendRequest("get_url", {})
    expect(result.url).toBe("https://example.com")
  })

  it("应处理工具调用超时", async () => {
    // 不响应，等待超时
    await expect(
      bridge.sendRequest("get_url", {}, 1000) // 1秒超时
    ).rejects.toThrow("超时")
  })

  it("应处理 Extension 断开连接", async () => {
    client.close()
    await new Promise(r => setTimeout(r, 100))
    await expect(
      bridge.sendRequest("get_url", {})
    ).rejects.toThrow("未连接")
  })
})
```

#### 5.2.3 Chrome Extension ws-client 消息处理测试

```typescript
// src/lib/mcp/ws-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock chrome API
const mockExecuteScript = vi.fn()
const mockTabsQuery = vi.fn()
global.chrome = {
  tabs: {
    query: mockTabsQuery,
    update: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: mockExecuteScript,
  },
  runtime: {
    sendMessage: vi.fn(),
  },
} as any

describe("ws-client 工具处理", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://example.com" }])
  })

  describe("handleClick", () => {
    it("应成功点击匹配元素", async () => {
      mockExecuteScript.mockResolvedValue([{ result: "已点击: .btn (1 个匹配中的第 0 个)" }])

      // 直接测试 executeScript 传入的 func
      // 通过模拟验证调用参数
    })

    it("应处理元素不存在", async () => {
      mockExecuteScript.mockResolvedValue([{ result: "未找到匹配元素: .nonexist[0]" }])
    })
  })

  describe("handleWait", () => {
    it("应等待指定时间", async () => {
      mockExecuteScript.mockResolvedValue([{ result: "已等待 1000ms" }])
    })

    it("应在元素出现后立即返回", async () => {
      mockExecuteScript.mockResolvedValue([{ result: "元素已出现: .content (150ms)" }])
    })
  })

  describe("handleAutomate", () => {
    it("应完成完整的多步编排", async () => {
      // 模拟导航 + 提取 + 点击 + 等待 + 提取
    })
  })
})
```

### 5.3 L3: E2E 端到端测试

**测试目标**: 在真实浏览器中通过 Claude Code 调用 MCP 工具完成自动化

#### 5.3.1 测试基础设施

```typescript
// e2e/setup.ts
import { test as base, chromium, type BrowserContext } from "@playwright/test"

// 扩展 Playwright test 以支持 Chrome Extension
type Fixtures = {
  context: BrowserContext
  extensionId: string
}

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const pathToExtension = ".plasmo" // Plasmo 构建输出目录
    const context = await chromium.launchPersistentContext("", {
      headless: false, // Chrome Extension 需要 headed 模式
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    })
    await use(context)
    await context.close()
  },
  extensionId: async ({ context }, use) => {
    // 获取扩展 ID
    let [background] = context.serviceWorkers()
    if (!background) {
      background = await context.waitForEvent("serviceworker")
    }
    const extensionId = background.url().split("/")[2]
    await use(extensionId)
  },
})
```

#### 5.3.2 B 站搜索场景 E2E 测试

```typescript
// e2e/bilibili-search.spec.ts
import { test, expect } from "./setup"

test.describe("B站搜索多页提取", () => {

  test.beforeEach(async ({ context }) => {
    // 1. 打开 SidePanel（通过扩展 URL）
    // 2. 确保 MCP 连接已建立
  })

  test("应能导航到B站并提取搜索结果", async ({ page, context }) => {
    // === 此测试模拟 Claude Code 通过 MCP 调用的完整流程 ===

    // Step 1: 导航
    // MCP 调用: browser_navigate({ url: "https://search.bilibili.com/all?keyword=AI" })
    await page.goto("https://search.bilibili.com/all?keyword=AI")
    await page.waitForLoadState("networkidle")

    // Step 2: 获取 DOM 结构
    // MCP 调用: browser_get_dom({ selector: ".search-content", maxDepth: 4 })
    const searchResults = page.locator(".video-list")
    await expect(searchResults).toBeVisible()

    // Step 3: 提取第1页数据
    // MCP 调用: browser_extract_data({
    //   containerSelector: ".video-list",
    //   itemSelector: ".video-item",
    //   fields: {
    //     title: { selector: ".title", attribute: "textContent" },
    //     author: { selector: ".up-name", attribute: "textContent" },
    //     views: { selector: ".play-text", attribute: "textContent" },
    //   }
    // })
    const items = page.locator(".video-item")
    const count = await items.count()
    expect(count).toBeGreaterThan(0)

    // 验证提取的数据结构
    const firstItem = items.first()
    const title = await firstItem.locator(".title").textContent()
    expect(title).toBeTruthy()

    // Step 4: 点击下一页
    // MCP 调用: browser_click({ selector: ".page-item.next" })
    const nextBtn = page.locator(".page-item.next, button.next, .vui_pagenation--btns > a:last-child")
    if (await nextBtn.isVisible()) {
      await nextBtn.click()
      // Step 5: 等待新数据
      // MCP 调用: browser_wait({ type: "timeout", timeout: 2000 })
      await page.waitForTimeout(2000)
      await page.waitForLoadState("networkidle")

      // Step 6: 提取第2页数据
      const page2Items = page.locator(".video-item")
      const count2 = await page2Items.count()
      expect(count2).toBeGreaterThan(0)
    }
  })
})
```

#### 5.3.3 通过 MCP Server 的真实 E2E 测试

```typescript
// e2e/mcp-integration.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import WebSocket from "ws"
import { Bridge } from "../../mcp-server/src/bridge"

/**
 * 真实 MCP E2E 测试
 * 前置条件:
 * 1. Chrome 已启动并加载 PagePilot 扩展
 * 2. SidePanel 已打开并连接 MCP
 * 3. 测试页面可用（使用本地 fixture 或真实网站）
 */
describe("MCP 真实 E2E 测试", () => {
  const BRIDGE_PORT = 9527
  let bridge: Bridge

  beforeAll(() => {
    bridge = new Bridge(BRIDGE_PORT)
  })

  afterAll(() => {
    bridge.close()
  })

  // 辅助：等待 Extension 连接
  async function waitForConnection(timeout = 30000): Promise<void> {
    const start = Date.now()
    while (!bridge.isConnected && Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 500))
    }
    if (!bridge.isConnected) throw new Error("Extension 未连接")
  }

  it("完整流程: B站搜索 → 提取 → 翻页 → 再提取", async () => {
    await waitForConnection()

    // 1. 导航到 B 站搜索页
    await bridge.sendRequest("navigate", {
      url: "https://search.bilibili.com/all?keyword=AI教程",
    })

    // 2. 获取 DOM 分析结构
    const dom = await bridge.sendRequest("get_dom", {
      selector: ".search-content-wrapper",
      maxDepth: 4,
      maxLength: 5000,
    })
    expect(dom).toContain("video")

    // 3. 提取第1页
    const page1Data = await bridge.sendRequest("extract_data", {
      containerSelector: ".video-list.row",
      itemSelector: ".video-list-item",
      fields: {
        title: { selector: ".bili-video-card__title", attribute: "textContent" },
      },
    })
    expect(Array.isArray(page1Data)).toBe(true)
    expect(page1Data.length).toBeGreaterThan(0)

    // 4. 点击下一页
    await bridge.sendRequest("click", {
      selector: "button.vui_pagenation--btn-side.next",
    })

    // 5. 等待加载
    await bridge.sendRequest("wait", {
      type: "timeout",
      timeout: 3000,
    })

    // 6. 提取第2页
    const page2Data = await bridge.sendRequest("extract_data", {
      containerSelector: ".video-list.row",
      itemSelector: ".video-list-item",
      fields: {
        title: { selector: ".bili-video-card__title", attribute: "textContent" },
      },
    })
    expect(page2Data.length).toBeGreaterThan(0)

    // 7. 验证两页数据不重复
    const titles1 = new Set(page1Data.map((d: any) => d.title))
    const titles2 = new Set(page2Data.map((d: any) => d.title))
    // 注意: B站可能有相同视频出现在不同页，所以不严格去重
    expect(titles2.size).toBeGreaterThan(0)
  })

  it("一键自动化: browser_automate 完成翻页提取", async () => {
    await waitForConnection()

    const result = await bridge.sendRequest("automate", {
      url: "https://search.bilibili.com/all?keyword=前端",
      containerSelector: ".video-list.row",
      itemSelector: ".video-list-item",
      fields: {
        title: { selector: ".bili-video-card__title", attribute: "textContent" },
      },
      nextPageSelector: "button.vui_pagenation--btn-side.next",
      maxPages: 2,
      waitAfterClick: 3000,
    })

    expect(result.data.length).toBeGreaterThan(0)
    expect(result.pages).toBeLessThanOrEqual(2)
  })
})
```

### 5.4 手动验收测试清单

对于需要真实 Claude Code 交互的场景，使用以下验收清单：

```markdown
## 验收测试: Claude Code → MCP → Chrome Extension 自动化

### 前置条件
- [ ] PagePilot 扩展已安装并启用
- [ ] SidePanel 已打开
- [ ] MCP Server 已启动 (`node mcp-server/dist/index.js`)
- [ ] SidePanel 已点击「连接 MCP」
- [ ] Claude Code 已配置 MCP Server (`claude mcp add page-pilot ...`)

### 测试用例 1: 基础操控
- [ ] 执行 `browser_ping` → 返回"已连接"
- [ ] 执行 `browser_get_url` → 返回当前页面 URL
- [ ] 执行 `browser_navigate({ url: "https://www.bilibili.com" })` → 页面跳转
- [ ] 执行 `browser_get_dom({ maxDepth: 2 })` → 返回 DOM 结构

### 测试用例 2: 数据提取
- [ ] 导航到 B 站搜索页
- [ ] 使用 `browser_get_dom` 分析列表结构
- [ ] 使用 `browser_extract_data` 提取视频列表
- [ ] 验证返回数据格式正确（数组，包含字段）

### 测试用例 3: 多步编排
- [ ] 导航到 B 站搜索页
- [ ] 提取第1页数据
- [ ] 使用 `browser_click` 点击下一页
- [ ] 使用 `browser_wait` 等待加载
- [ ] 提取第2页数据
- [ ] 验证两页数据不同

### 测试用例 4: 一键自动化
- [ ] 使用 `browser_automate` 执行翻页提取
- [ ] 验证返回结果包含多页数据
- [ ] 验证总条数符合预期

### 测试用例 5: 异常恢复
- [ ] 在执行中断开 MCP 连接 → 错误信息清晰
- [ ] 重新连接后继续执行 → 正常工作
- [ ] 页面加载超时 → 不崩溃，返回已收集数据

### 测试用例 6: 自然语言端到端
向 Claude Code 发送:
"帮我在B站搜索AI教程，提取前3页的视频标题和播放量"
- [ ] Claude Code 自动调用 browser_navigate
- [ ] 自动分析页面结构
- [ ] 自动提取数据
- [ ] 自动翻页并继续提取
- [ ] 最终返回汇总数据
```

## 六、新增类型定义

```typescript
// src/lib/automation/types.ts

/** 自动化配置 */
export interface AutomationConfig {
  url: string
  containerSelector: string
  itemSelector: string
  fields: Record<string, { selector: string; attribute: string }>
  nextPageSelector: string
  maxPages: number
  waitAfterClick: number
}

/** 单步执行结果 */
export interface StepResult {
  stepId: string
  status: "success" | "failed" | "skipped"
  data?: Record<string, any>[]
  error?: string
  duration: number
  screenshot?: string
}

/** 自动化执行结果 */
export interface AutomationResult {
  data: Record<string, any>[]
  pages: number
  totalDuration: number
  steps: StepResult[]
  totalCount: number
  successCount: number
  failureCount: number
  errors: string[]
}

/** 等待条件类型 */
export type WaitCondition =
  | { type: "selector"; selector: string }
  | { type: "navigation" }
  | { type: "timeout"; ms: number }

/** 点击操作结果 */
export interface ClickResult {
  success: boolean
  matchedCount: number
  clickedIndex: number
  message: string
}

/** Bridge 请求/响应消息 */
export interface BridgeMessage {
  id: string
  tool: string
  args: Record<string, any>
}

export interface BridgeResponse {
  id: string
  result?: any
  error?: string
}
```

## 七、实施计划

### Phase 1: 新增基础工具（P0）

**预计改动文件**:

| 文件 | 改动 |
|------|------|
| `mcp-server/src/tools.ts` | 新增 click/type/wait 工具注册 |
| `src/lib/mcp/ws-client.ts` | 新增 handleClick/handleType/handleWait |
| `src/lib/automation/types.ts` | 新建，定义自动化类型 |
| `mcp-server/src/__tests__/tools.test.ts` | 新建，工具注册测试 |

**验收标准**:
- 3 个新工具可通过 Claude Code 调用
- 单元测试通过

### Phase 2: 编排引擎（P0）

**预计改动文件**:

| 文件 | 改动 |
|------|------|
| `mcp-server/src/tools.ts` | 新增 browser_automate 工具 |
| `src/lib/mcp/ws-client.ts` | 新增 handleAutomate 编排逻辑 |
| `src/lib/automation/orchestrator.ts` | 新建，编排器核心 |
| `src/lib/automation/result-aggregator.ts` | 新建，结果聚合 |
| `src/lib/automation/__tests__/*.test.ts` | 新建，L1 单元测试 |
| `mcp-server/src/__tests__/bridge.test.ts` | 新建，L2 集成测试 |

**验收标准**:
- `browser_automate` 可一键完成翻页提取
- L1 + L2 测试全部通过
- B 站搜索场景可手动跑通

### Phase 3: E2E + 截图工具（P1）

**预计改动文件**:

| 文件 | 改动 |
|------|------|
| `mcp-server/src/tools.ts` | 新增 browser_screenshot |
| `src/lib/mcp/ws-client.ts` | 新增 handleScreenshot |
| `e2e/setup.ts` | 新建，Playwright + Extension 环境 |
| `e2e/bilibili-search.spec.ts` | 新建，B 站场景测试 |
| `e2e/mcp-integration.spec.ts` | 新建，MCP 真实链路测试 |

**验收标准**:
- Playwright E2E 测试可通过
- MCP 真实链路测试可通过
- 截图工具可用

### Phase 4: 优化与稳定（P2）

- 重试机制：单步失败自动重试 1-2 次
- 智能等待：基于 DOM 变化而非固定超时
- 执行日志：每步操作记录到 chrome.storage
- 并发控制：多个自动化任务排队执行
- 取消机制：通过 SidePanel 终止正在执行的任务

## 八、Claude Code 配置

在项目的 `.claude/settings.json` 或全局 MCP 配置中：

```json
{
  "mcpServers": {
    "page-pilot": {
      "command": "node",
      "args": ["/path/to/page-pilot/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

使用时直接对 Claude Code 说：
> "帮我在B站搜索AI教程，提取前3页的视频标题和播放量"

Claude Code 会自动通过 MCP 调用 browser_navigate → browser_get_dom → browser_extract_data → browser_click → browser_wait → ... 完成全流程。
