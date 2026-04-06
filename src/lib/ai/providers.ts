import type { Settings, AIProviderConfig } from "../types"

const SETTINGS_KEY = "pagepilot_settings"

const DEFAULT_SETTINGS: Settings = {
  ai: {
    providerId: "deepseek",
    apiKey: "",
    model: "deepseek-chat",
  },
}

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
    models: ["glm-4-flash", "glm-4-plus", "glm-4"],
    defaultModel: "glm-4-flash",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-coder"],
    defaultModel: "deepseek-chat",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    models: [
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-3-opus",
      "openai/gpt-4-turbo",
      "openai/gpt-4o",
    ],
    defaultModel: "anthropic/claude-3.5-sonnet",
  },
}

export function getProvider(id: string): ProviderInfo {
  return PROVIDERS[id]
}
