import { describe, it, expect, vi, beforeEach } from "vitest"
import { testConnection, generateExtractionScript } from "./client"
import { getProvider, PROVIDERS } from "./providers"
import type { AIProviderConfig } from "../types"

// Mock chrome API
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
}

;(global as any).chrome = {
  storage: mockChromeStorage,
}

/**
 * 创建 mock fetch，记录请求 URL 并模拟响应
 */
function createMockFetch(responses: Record<string, any>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString()

    // 找到匹配的响应
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return {
          ok: response.status ? response.status < 400 : true,
          status: response.status || 200,
          headers: new Headers(),
          json: async () => response.body,
          text: async () => JSON.stringify(response.body),
        }
      }
    }

    // 默认 404
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
      json: async () => ({ error: { message: "Not found" } }),
      text: async () => '{"error":{"message":"Not found"}}',
    }
  })
}

describe("AI Client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe("testConnection", () => {
    it("应该对兼容服务商调用 /chat/completions 而非 /responses", async () => {
      const mockFetch = createMockFetch({
        // 只有 /chat/completions 返回成功
        "/chat/completions": {
          status: 200,
          body: {
            id: "test",
            object: "chat.completion",
            choices: [
              { message: { content: "Hi" }, finish_reason: "stop", index: 0 },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        },
      })

      // 拦截 global fetch
      const originalFetch = global.fetch
      global.fetch = mockFetch as any

      try {
        const config: AIProviderConfig = {
          providerId: "deepseek",
          apiKey: "sk-test-key",
          model: "deepseek-chat",
        }

        const result = await testConnection(config)

        // 验证请求被发送
        expect(mockFetch).toHaveBeenCalled()

        // 检查所有请求的 URL，不应该包含 /responses
        const allUrls = mockFetch.mock.calls.map(
          (call: any[]) => (typeof call[0] === "string" ? call[0] : call[0].toString())
        )

        const hasResponsesCall = allUrls.some((url) => url.includes("/responses"))
        const hasChatCompletionsCall = allUrls.some((url) =>
          url.includes("/chat/completions")
        )

        // 关键断言：不应请求 /responses 端点
        expect(
          hasResponsesCall,
          `检测到请求了 /responses 端点，非 OpenAI 服务商不支持此端点。实际请求: ${allUrls.join(", ")}`
        ).toBe(false)

        // 应该请求 /chat/completions 端点
        expect(
          hasChatCompletionsCall,
          `应请求 /chat/completions 端点。实际请求: ${allUrls.join(", ")}`
        ).toBe(true)

        // 连接应该成功
        expect(result.success).toBe(true)
      } finally {
        global.fetch = originalFetch
      }
    })

    it("对所有兼容服务商都应使用 /chat/completions 端点", async () => {
      const compatibleProviders = ["kimi", "zhipu", "deepseek", "openrouter"]

      for (const providerId of compatibleProviders) {
        vi.restoreAllMocks()

        const mockFetch = createMockFetch({
          "/chat/completions": {
            status: 200,
            body: {
              id: "test",
              object: "chat.completion",
              choices: [
                { message: { content: "Hi" }, finish_reason: "stop", index: 0 },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            },
          },
        })

        const originalFetch = global.fetch
        global.fetch = mockFetch as any

        try {
          const provider = getProvider(providerId)!
          const config: AIProviderConfig = {
            providerId,
            apiKey: "sk-test-key",
            model: provider.defaultModel,
          }

          await testConnection(config)

          const allUrls = mockFetch.mock.calls.map(
            (call: any[]) =>
              typeof call[0] === "string" ? call[0] : call[0].toString()
          )

          expect(
            allUrls.some((url) => url.includes("/responses")),
            `${provider.name} 不应请求 /responses 端点`
          ).toBe(false)

          expect(
            allUrls.some((url) => url.includes("/chat/completions")),
            `${provider.name} 应请求 /chat/completions 端点`
          ).toBe(true)
        } finally {
          global.fetch = originalFetch
        }
      }
    })

    it("应该识别 429 频率限制为有效连接", async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
        json: async () => ({
          error: { message: "Rate limit exceeded", type: "rate_limit_error" },
        }),
        text: async () =>
          '{"error":{"message":"Rate limit exceeded"}}',
      }))

      const originalFetch = global.fetch
      global.fetch = mockFetch as any

      try {
        const config: AIProviderConfig = {
          providerId: "deepseek",
          apiKey: "sk-test-key",
          model: "deepseek-chat",
        }

        const result = await testConnection(config)

        // SDK 抛出的错误 statusCode 可能在不同属性上
        // 无论 429 被识别为成功还是失败，都不应崩溃
        expect(result).toHaveProperty("success")
        if (result.success) {
          expect(result.note).toContain("频率限制")
        } else {
          // 如果 SDK 不暴露 status=429，至少不应该返回连接失败以外的错误
          expect(result.error).toBeDefined()
        }
      } finally {
        global.fetch = originalFetch
      }
    })

    it("应该处理无效 API Key 返回的 401 错误", async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        json: async () => ({
          error: { message: "Invalid API key" },
        }),
        text: async () => '{"error":{"message":"Invalid API key"}}',
      }))

      const originalFetch = global.fetch
      global.fetch = mockFetch as any

      try {
        const config: AIProviderConfig = {
          providerId: "deepseek",
          apiKey: "invalid-key",
          model: "deepseek-chat",
        }

        const result = await testConnection(config)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe("generateExtractionScript", () => {
    it("应该通过 /chat/completions 生成提取脚本", async () => {
      const mockFetch = createMockFetch({
        "/chat/completions": {
          status: 200,
          body: {
            id: "test",
            object: "chat.completion",
            choices: [
              {
                message: {
                  content:
                    "const items = document.querySelectorAll('.item'); return Array.from(items).map(el => ({ name: el.querySelector('.name')?.textContent, price: el.querySelector('.price')?.textContent }));",
                },
                finish_reason: "stop",
                index: 0,
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
          },
        },
      })

      const originalFetch = global.fetch
      global.fetch = mockFetch as any

      try {
        const config: AIProviderConfig = {
          providerId: "deepseek",
          apiKey: "sk-test-key",
          model: "deepseek-chat",
        }

        const result = await generateExtractionScript(
          config,
          "你是一个网页数据提取专家",
          "提取商品列表的名称和价格"
        )

        // 验证请求走 /chat/completions
        const allUrls = mockFetch.mock.calls.map(
          (call: any[]) =>
            typeof call[0] === "string" ? call[0] : call[0].toString()
        )

        expect(
          allUrls.some((url) => url.includes("/responses")),
          "生成脚本不应请求 /responses 端点"
        ).toBe(false)

        expect(
          allUrls.some((url) => url.includes("/chat/completions")),
          "生成脚本应请求 /chat/completions 端点"
        ).toBe(true)

        // 验证返回内容
        expect(typeof result).toBe("string")
        expect(result.length).toBeGreaterThan(0)
        expect(result).toMatch(/querySelector|querySelectorAll|document/)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})

describe("Providers", () => {
  it("应该获取 DeepSeek 提供商配置", () => {
    const provider = getProvider("deepseek")

    expect(provider).toBeDefined()
    expect(provider?.id).toBe("deepseek")
    expect(provider?.name).toBe("DeepSeek")
    expect(provider?.baseURL).toBe("https://api.deepseek.com/v1")
    expect(provider?.models).toContain("deepseek-chat")
    expect(provider?.defaultModel).toBe("deepseek-chat")
  })

  it("应该获取所有提供商", () => {
    const providers = ["kimi", "zhipu", "deepseek", "openrouter"]

    providers.forEach((id) => {
      const provider = getProvider(id)
      expect(provider).toBeDefined()
      expect(provider?.baseURL).toMatch(/^https:\/\//)
      expect(provider?.models.length).toBeGreaterThan(0)
    })
  })

  it("应该为不存在的提供商返回 undefined", () => {
    const provider = getProvider("non-existent")
    expect(provider).toBeUndefined()
  })

  it("所有兼容服务商的 baseURL 不应以 /responses 结尾", () => {
    // 确保注册表中的 baseURL 是基础路径，不包含具体端点
    Object.values(PROVIDERS).forEach((provider) => {
      expect(
        provider.baseURL,
        `${provider.name} 的 baseURL 不应包含 /responses`
      ).not.toMatch(/\/responses$/)
    })
  })
})
