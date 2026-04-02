export interface ProviderInfo {
  id: string
  name: string
  baseURL: string
  models: string[]
  defaultModel: string
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  kimi: {
    id: "kimi",
    name: "Kimi（月之暗面）",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k"],
    defaultModel: "moonshot-v1-auto",
  },
  zhipu: {
    id: "zhipu",
    name: "智谱（GLM）",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4", "glm-4-flash", "glm-4-plus"],
    defaultModel: "glm-4",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "google/gemini-2.0-flash"],
    defaultModel: "openai/gpt-4o",
  },
}

export function getProvider(id: string): ProviderInfo {
  return PROVIDERS[id]
}
