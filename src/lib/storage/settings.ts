import type { Settings, AIProviderConfig } from "../types"

const SETTINGS_KEY = "pagepilot_settings"

const DEFAULT_SETTINGS: Settings = {
  ai: {
    providerId: "deepseek",
    apiKey: "",
    model: "deepseek-chat",
  },
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return result[SETTINGS_KEY] || DEFAULT_SETTINGS
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

export async function getAIConfig(): Promise<AIProviderConfig> {
  const settings = await getSettings()
  return settings.ai
}
