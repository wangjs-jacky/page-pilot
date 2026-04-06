# PagePilot 开发指南

## 环境要求

- Node.js >= 16
- pnpm (推荐) 或 npm

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式 (HMR)
pnpm dev

# 生产构建
pnpm build

# 运行测试
pnpm test
```

## 项目结构

```
page-pilot/
├── src/
│   ├── lib/                    # 核心库
│   │   ├── ai/                 # AI 相关
│   │   │   ├── client.ts           # AI 客户端
│   │   │   ├── client.test.ts      # 客户端测试
│   │   │   ├── providers.ts        # 服务商配置
│   │   │   └── prompt-builder.ts   # Prompt 构建
│   │   ├── storage/            # 存储
│   │   │   ├── settings.ts         # 设置存储
│   │   │   ├── settings.test.ts
│   │   │   ├── scripts.ts          # 脚本存储
│   │   │   └── scripts.test.ts
│   │   ├── selector/           # 选择器
│   │   │   ├── calculator.ts       # 选择器计算
│   │   │   └── calculator.test.ts
│   │   ├── export/             # 导出功能
│   │   │   └── index.ts            # JSON/CSV/下载
│   │   └── types.ts            # 类型定义
│   ├── background/             # Service Worker
│   │   └── index.ts
│   ├── sidepanel/              # 侧边栏主界面
│   │   ├── index.tsx               # 入口 + 视图状态机
│   │   ├── views/                  # 视图组件
│   │   │   ├── ScriptLibrary.tsx
│   │   │   ├── ElementPicker.tsx
│   │   │   ├── ScriptPreview.tsx
│   │   │   └── ResultView.tsx
│   │   └── components/             # UI 组件
│   │       ├── FieldList.tsx
│   │       ├── ScriptCard.tsx
│   │       ├── DataTable.tsx
│   │       └── ExportBar.tsx
│   ├── options/                # 设置页面
│   │   └── index.tsx
│   ├── contents/               # Content Scripts
│   │   └── element-picker.ts
│   └── style.css               # 全局样式
├── build/                      # 构建输出
├── .plasmo/                    # Plasmo 临时文件
├── manifest.json               # 扩展清单
├── vitest.config.ts            # 测试配置
└── docs/                       # 文档
    ├── ARCHITECTURE.md             # 架构设计
    └── DEVELOPMENT.md              # 本文件
```

## 核心模块 API

### AI 客户端 (`src/lib/ai/client.ts`)

```typescript
// 测试 AI 连接
testConnection(config: AIProviderConfig): Promise<{
  success: boolean
  latency?: number    // 响应时间 (ms)
  note?: string       // 备注 (如频率限制)
  error?: string      // 错误信息
}>

// 生成提取脚本
generateExtractionScript(config, systemPrompt, userPrompt): Promise<string>
```

### 存储管理 (`src/lib/storage/`)

**Settings (`settings.ts`)**

```typescript
getSettings(): Promise<Settings>
saveSettings(settings: Settings): Promise<void>
getAIConfig(): Promise<AIProviderConfig>
```

**Scripts (`scripts.ts`)**

```typescript
saveScript(script: ExtractionScript): Promise<void>
getAllScripts(): Promise<ExtractionScript[]>
deleteScript(id: string): Promise<void>
findMatchingScripts(url: string): Promise<ExtractionScript[]>
```

### 选择器计算 (`src/lib/selector/calculator.ts`)

```typescript
calculateSelector(element: Element): string
```

计算策略优先级：ID → data 属性 → class 组合 → nth-child

### 导出 (`src/lib/export/index.ts`)

```typescript
toJSON(data: Record<string, any>[]): string
toCSV(data: Record<string, any>[]): string
downloadFile(content: string, filename: string, mimeType: string): void
copyToClipboard(text: string): Promise<void>
```

## 添加新 AI 服务商

1. **在 `src/lib/ai/providers.ts` 添加配置**：

```typescript
export const PROVIDERS: Record<string, ProviderInfo> = {
  // ... 现有配置
  newProvider: {
    id: "newProvider",
    name: "新服务商",
    baseURL: "https://api.example.com/v1",
    models: ["model-1", "model-2"],
    defaultModel: "model-1",
  },
}
```

2. **在 `src/lib/types.ts` 扩展类型**：

```typescript
export interface AIProviderConfig {
  providerId: "kimi" | "zhipu" | "deepseek" | "openrouter" | "local" | "newProvider"
  // ...
}
```

## 测试

测试覆盖的核心模块：

| 模块 | 测试文件 | 覆盖函数 |
|------|----------|----------|
| AI 客户端 | `client.test.ts` | `testConnection`, `generateExtractionScript` |
| 设置存储 | `settings.test.ts` | `getSettings`, `saveSettings`, `getAIConfig` |
| 脚本存储 | `scripts.test.ts` | `saveScript`, `getAllScripts`, `deleteScript` |
| 选择器 | `calculator.test.ts` | `calculateSelector` |

## 常见问题

### API 连接失败
- 检查 baseURL 是否正确（必须包含 `/v1` 路径）
- 验证 API Key 是否有效
- 检查网络连接和代理设置

### 选择器不准确
- 优先使用带 data-* 属性的元素
- 避免使用动态生成的 class（如 `css-*`、`sc-*`）
- 对于列表项，使用语义化的父容器

### 构建错误
```bash
# 清理缓存重新构建
rm -rf .plasmo build
pnpm build
```

## 发布流程

1. 更新 `package.json` 版本号
2. 运行测试：`pnpm test`
3. 构建生产版本：`pnpm build`
4. 在 `chrome://extensions` 中测试
5. 打包为 `.crx` 或发布到 Chrome Web Store
