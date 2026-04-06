# PagePilot

<div align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/tests-passing-brightgreen" alt="tests">
</div>

**AI 驱动的网页数据提取 Chrome 扩展**

PagePilot 利用 AI 技术自动识别网页结构并生成数据提取脚本，帮助用户快速提取网页中的结构化数据。

## ✨ 核心特性

- 🤖 **AI 驱动** - 支持多个 AI 服务商（DeepSeek, Kimi, 智谱, OpenRouter）
- 🎯 **智能选择器** - 自动生成最优 CSS 选择器
- 💾 **脚本管理** - 保存和复用提取脚本
- 📊 **数据导出** - 支持 JSON/CSV 格式导出
- 🔍 **URL 匹配** - 自动识别并应用适合的提取脚本

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/wangjs-jacky/page-pilot.git
cd page-pilot

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

### 加载扩展

1. 打开 Chrome，访问 `chrome://extensions`
2. 启用 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `build/chrome-mv3-dev` 目录

### 配置 AI 服务

1. 点击扩展图标，打开 SidePanel
2. 点击 **设置** 按钮
3. 选择 AI 服务商
4. 输入 API Key
5. 点击 **测试连接** 验证
6. 点击 **保存设置**

## 📖 使用指南

### 1. 创建提取脚本

1. 打开目标网页
2. 点击 PagePilot 图标
3. 点击 **新建脚本**
4. 点击页面元素进行选择
5. 添加要提取的字段
6. 点击 **生成脚本**
7. 保存脚本

### 2. 执行提取

1. 访问匹配的网页
2. PagePilot 会自动识别适用的脚本
3. 点击 **执行** 按钮
4. 查看提取结果
5. 导出为 JSON 或 CSV

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 监听模式
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 测试覆盖

- ✅ AI 客户端（连接测试、脚本生成）
- ✅ 存储管理（设置、脚本）
- ✅ 选择器计算（ID、class、路径）
- ✅ DOM 上下文提取

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Plasmo | 0.90.5 | Chrome 扩展框架 |
| React | 18.3.1 | UI 框架 |
| TypeScript | 5.7.3 | 类型安全 |
| Tailwind CSS | 3.4.17 | 样式系统 |
| Vercel AI SDK | 6.0.142 | AI 集成 |
| Vitest | 4.1.2 | 测试框架 |

## 📁 项目结构

```
page-pilot/
├── src/
│   ├── lib/
│   │   ├── ai/              # AI 集成
│   │   ├── storage/         # 数据存储
│   │   ├── selector/        # 选择器工具
│   │   └── types.ts         # 类型定义
│   ├── sidepanel/           # 侧边栏 UI
│   ├── options/             # 设置页面
│   ├── background/          # Service Worker
│   └── contents/            # Content Scripts
├── build/                   # 构建输出
└── .plasmo/                # Plasmo 临时文件
```

## 🔧 配置

### 支持的 AI 服务商

| 服务商 | 模型 | 特点 |
|--------|------|------|
| DeepSeek | deepseek-chat, deepseek-coder | 默认推荐 |
| Kimi | moonshot-v1-8k/32k | 长文本支持 |
| 智谱 | glm-4-flash/plus | 快速响应 |
| OpenRouter | claude-3.5-sonnet, gpt-4-turbo | 多模型选择 |

### 添加新服务商

在 `src/lib/ai/providers.ts` 中添加配置：

```typescript
newProvider: {
  id: "newProvider",
  name: "新服务商",
  baseURL: "https://api.example.com/v1",
  models: ["model-1", "model-2"],
  defaultModel: "model-1"
}
```

## 🐛 故障排除

### API 连接失败

1. 检查 API Key 是否正确
2. 确认网络连接正常
3. 验证 baseURL 配置（必须包含 `/v1`）

### 选择器不准确

1. 优先选择带 `data-*` 属性的元素
2. 避免动态生成的 class
3. 使用语义化的父容器

### 构建错误

```bash
# 清理缓存重新构建
rm -rf .plasmo build
pnpm build
```

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🤝 贡献

欢迎贡献！请查看 [CLAUDE.md](CLAUDE.md) 了解开发指南。

## 📮 更新日志

### v0.1.0 (2024-04-07)
- ✨ 初始发布
- 🤖 DeepSeek 集成
- 🧪 完整测试覆盖
- 📝 完整文档

---

<div align="center">
  Made with ❤️ by Jacky Wang
</div>
