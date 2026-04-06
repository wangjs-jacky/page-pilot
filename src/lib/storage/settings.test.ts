import { describe, it, expect, vi, beforeEach } from "vitest"
import { getSettings, saveSettings, getAIConfig } from "./settings"
import type { Settings, AIProviderConfig } from "../types"

// Mock chrome.storage API
const mockStorage: Record<string, any> = {}

const mockChromeStorage = {
  local: {
    get: vi.fn((key: string) => {
      return Promise.resolve(mockStorage[key] ? { [key]: mockStorage[key] } : {})
    }),
    set: vi.fn((data: Record<string, any>) => {
      Object.assign(mockStorage, data)
      return Promise.resolve()
    }),
  },
}

;(global as any).chrome = {
  storage: mockChromeStorage,
}

describe("Settings Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 清空 mock 存储
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  describe("getSettings", () => {
    it("应该返回默认设置（当存储为空时）", async () => {
      const settings = await getSettings()

      expect(settings).toEqual({
        ai: {
          providerId: "deepseek",
          apiKey: "",
          model: "deepseek-chat",
        },
      })
    })

    it("应该返回已保存的设置", async () => {
      const savedSettings: Settings = {
        ai: {
          providerId: "kimi",
          apiKey: "test-api-key",
          model: "moonshot-v1-8k",
        },
      }

      mockStorage["pagepilot_settings"] = savedSettings

      const settings = await getSettings()

      expect(settings).toEqual(savedSettings)
      expect(mockChromeStorage.local.get).toHaveBeenCalledWith("pagepilot_settings")
    })
  })

  describe("saveSettings", () => {
    it("应该保存设置到存储", async () => {
      const newSettings: Settings = {
        ai: {
          providerId: "zhipu",
          apiKey: "zhipu-api-key",
          model: "glm-4-flash",
        },
      }

      await saveSettings(newSettings)

      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        pagepilot_settings: newSettings,
      })
      expect(mockStorage["pagepilot_settings"]).toEqual(newSettings)
    })

    it("应该覆盖现有设置", async () => {
      const oldSettings: Settings = {
        ai: {
          providerId: "kimi",
          apiKey: "old-key",
          model: "moonshot-v1-8k",
        },
      }

      mockStorage["pagepilot_settings"] = oldSettings

      const newSettings: Settings = {
        ai: {
          providerId: "deepseek",
          apiKey: "new-key",
          model: "deepseek-chat",
        },
      }

      await saveSettings(newSettings)

      expect(mockStorage["pagepilot_settings"]).toEqual(newSettings)
    })
  })

  describe("getAIConfig", () => {
    it("应该返回 AI 配置", async () => {
      const settings: Settings = {
        ai: {
          providerId: "deepseek",
          apiKey: "test-key",
          model: "deepseek-chat",
        },
      }

      mockStorage["pagepilot_settings"] = settings

      const aiConfig = await getAIConfig()

      expect(aiConfig).toEqual(settings.ai)
    })

    it("应该返回默认 AI 配置（当存储为空时）", async () => {
      const aiConfig = await getAIConfig()

      expect(aiConfig).toEqual({
        providerId: "deepseek",
        apiKey: "",
        model: "deepseek-chat",
      })
    })
  })
})
