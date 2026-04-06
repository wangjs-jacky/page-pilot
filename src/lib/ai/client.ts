import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import type { AIAnalysisResult, AIFieldCandidate, AIProviderConfig, ElementCapture, PaginationConfig } from "../types"
import { getProvider } from "./providers"
import { buildAnalysisPrompt, buildOptimizationPrompt, buildSmartCodePrompt, extractCodeFromResponse } from "./prompt-builder"

function createModel(config: AIProviderConfig) {
  const provider = getProvider(config.providerId)
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: provider.baseURL,
  })
  // 使用 .chat() 强制走 /chat/completions 端点，而非默认的 /responses（仅 OpenAI 支持）
  return openai.chat(config.model)
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
      maxRetries: 0,
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

// 分析元素结构，提取可提取字段
export async function analyzeElement(
  config: AIProviderConfig,
  capture: ElementCapture
): Promise<AIAnalysisResult> {
  const { systemPrompt, userPrompt } = buildAnalysisPrompt(capture)

  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 2000,
  })

  // 从 AI 响应中提取 JSON
  const text = result.text.trim()
  let jsonStr = text
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  try {
    const parsed = JSON.parse(jsonStr)
    return {
      cardSelector: parsed.cardSelector || capture.selector,
      containerSelector: parsed.containerSelector || "",
      fields: (parsed.fields || []).map((f: any) => ({
        name: f.name || "unknown",
        selector: f.selector || "",
        attribute: f.attribute || "textContent",
        sampleValue: f.sampleValue || "",
        confidence: f.confidence || "medium",
      })),
      paginationHint: parsed.paginationHint || null,
    }
  } catch {
    throw new Error("AI 返回格式异常，请重试")
  }
}

// 生成智能提取脚本（含同级遍历 + 分页）
export async function generateSmartScript(
  config: AIProviderConfig,
  fields: AIFieldCandidate[],
  cardSelector: string,
  containerSelector: string,
  pagination?: PaginationConfig
): Promise<string> {
  const { systemPrompt, userPrompt } = buildSmartCodePrompt(
    fields,
    cardSelector,
    containerSelector,
    pagination
  )

  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 3000,
  })

  return result.text
}

// 保留旧接口兼容
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

// 优化现有脚本
export async function optimizeScript(
  config: AIProviderConfig,
  code: string,
  requirement: string,
  executionResult?: Record<string, any>[]
): Promise<string> {
  const { systemPrompt, userPrompt } = buildOptimizationPrompt(code, requirement, executionResult)

  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 3000,
  })

  return extractCodeFromResponse(result.text)
}
