# PagePilot - AI 驱动的网页数据提取 Chrome 扩展

利用 AI 自动识别网页结构并生成数据提取脚本，帮助用户快速提取结构化数据。

## 技术栈

Plasmo v0.90.5 + React 18 + TypeScript + Tailwind CSS v3 + Vercel AI SDK

## 核心架构

- **SidePanel** — 视图状态机驱动四个视图切换 (library → picker → preview → result)
- **Background** — Tab 监听 + 消息路由 + MAIN world 脚本执行
- **Content Script** — 元素选择器（高亮 + CSS 选择器计算）
- **AI 模块** — OpenAI 兼容接口，5 个服务商通过 `PROVIDERS` 注册表统一管理
- **存储** — `chrome.storage.local`，分 settings 和 scripts 两层

## 消息协议

| 消息 | 方向 | 说明 |
|------|------|------|
| `START_PICKER` / `STOP_PICKER` | SidePanel → Content | 控制元素选择 |
| `ELEMENT_SELECTED` | Content → SidePanel | 选择结果 |
| `EXECUTE_IN_MAIN` | SidePanel → Background | 在 MAIN world 执行代码 |
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

## 开发规范

- **先写测试，再修 Bug**：遇到 Bug 时，必须先补充能复现问题的测试 case，测试通过后再修复代码。修复的衡量标准是测试 case 全部通过，而非手动验证。

## 开发命令

```bash
pnpm install   # 安装依赖
pnpm dev       # 开发模式
pnpm build     # 生产构建
pnpm test      # 运行测试
```

## Reference

- [架构设计](docs/ARCHITECTURE.md) — 模块职责、数据流、消息协议、Manifest 权限的完整说明
- [开发指南](docs/DEVELOPMENT.md) — 项目结构、API 参考、添加服务商、测试、发布流程
