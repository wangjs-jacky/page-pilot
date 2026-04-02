import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import type { AIProviderConfig } from "../types"
import { getProvider } from "./providers"

function createModel(config: AIProviderConfig) {
  const provider = getProvider(config.providerId)
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: provider.baseURL,
  })
  return openai(config.model)
}

// 测试连接
export async function testConnection(config: AIProviderConfig): Promise<{
  success: boolean
  latency?: number
  note?: string
  error?: string
}> {
  try {
    const start = Date.now()
    await generateText({
      model: createModel(config),
      prompt: "Hello",
      maxOutputTokens: 1,
    })
    return { success: true, latency: Date.now() - start }
  } catch (error: any) {
    // 429 频率限制也算成功
    if (error?.status === 429) {
      return { success: true, note: "频率限制，但 Key 有效" }
    }
    return { success: false, error: error?.message || "连接失败" }
  }
}

// 生成提取脚本
export async function generateExtractionScript(
  config: AIProviderConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 2000,
  })
  return result.text
}
