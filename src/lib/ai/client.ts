import { createOpenAI } from "@ai-sdk/openai"
import { generateText } from "ai"
import type { AIAnalysisResult, AIFieldCandidate, AIProviderConfig, AutoFixProgress, DryRunResult, ElementCapture, PaginationConfig } from "../types"
import { getProvider } from "./providers"
import { buildAnalysisPrompt, buildOptimizationPrompt, buildSmartCodePrompt, buildDryRunFixPrompt, extractCodeFromResponse, buildNextButtonAnalysisPrompt, parseNextButtonAnalysis, type NextButtonAnalysisResult, type DryRunFailure } from "./prompt-builder"

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
export interface OptimizeScriptResult {
  code: string          // 提取的脚本代码
  rawResponse: string   // AI 完整响应（含分析和建议）
}

export async function optimizeScript(
  config: AIProviderConfig,
  code: string,
  requirement: string,
  executionResult?: Record<string, any>[]
): Promise<OptimizeScriptResult> {
  const { systemPrompt, userPrompt } = buildOptimizationPrompt(code, requirement, executionResult)

  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 3000,
  })

  return {
    code: extractCodeFromResponse(result.text),
    rawResponse: result.text,
  }
}

// 分析下一页按钮元素，返回 AI 优化的选择器和翻页类型
export async function analyzeNextButton(
  config: AIProviderConfig,
  capture: ElementCapture
): Promise<NextButtonAnalysisResult> {
  const { systemPrompt, userPrompt } = buildNextButtonAnalysisPrompt(capture)

  const result = await generateText({
    model: createModel(config),
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 1000,
  })

  return parseNextButtonAnalysis(result.text)
}

// ==================== Dry-Run + 自动修复 ====================

const MAX_AUTO_FIX_ROUNDS = 3

// Dry-Run 执行：通过 Background 在当前页面执行代码并返回结果
async function executeDryRun(
  code: string,
  cardSelector: string,
  containerSelector: string
): Promise<DryRunResult> {
  const response = await chrome.runtime.sendMessage({
    type: "DRY_RUN_EXECUTE",
    payload: { code, cardSelector, containerSelector },
  })

  return {
    success: response?.success ?? (response?.itemCount > 0),
    data: response?.data,
    error: response?.error,
    itemCount: response?.itemCount ?? 0,
    firstCardHTML: response?.firstCardHTML,
  }
}

// 生成脚本并执行 Dry-Run + 自动修复循环的结果
export interface GenerateAndDryRunResult {
  code: string
  dryRunResult: DryRunResult
  fixRounds: number  // 修复了多少轮 (0 = 一次通过)
}

// 生成脚本并自动验证 + 修复
export async function generateAndDryRun(
  config: AIProviderConfig,
  fields: AIFieldCandidate[],
  cardSelector: string,
  containerSelector: string,
  pagination: PaginationConfig | undefined,
  onProgress?: (progress: AutoFixProgress) => void,
  signal?: { cancelled: boolean }
): Promise<GenerateAndDryRunResult> {
  // Step 1: 生成初始脚本
  onProgress?.({ round: 0, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "generating" })

  const response = await generateSmartScript(config, fields, cardSelector, containerSelector, pagination)
  let code = extractCodeFromResponse(response)

  // Step 2: Dry-Run 验证
  onProgress?.({ round: 0, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "dry-running" })

  let dryRunResult = await executeDryRun(code, cardSelector, containerSelector)

  // Step 3: 成功则直接返回
  if (dryRunResult.success && dryRunResult.itemCount > 0) {
    onProgress?.({ round: 0, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "success", dryRunResult })
    return { code, dryRunResult, fixRounds: 0 }
  }

  // Step 4: 自动修复循环
  for (let round = 1; round <= MAX_AUTO_FIX_ROUNDS; round++) {
    if (signal?.cancelled) {
      return { code, dryRunResult, fixRounds: round - 1 }
    }

    onProgress?.({ round, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "fixing", dryRunResult })

    // 构建失败上下文
    const failure: DryRunFailure = {
      type: dryRunResult.error ? "error" : dryRunResult.itemCount === 0 ? "empty" : "partial",
      errorMessage: dryRunResult.error,
      returnedData: dryRunResult.data,
      cardCount: dryRunResult.itemCount,
      firstCardHTML: dryRunResult.firstCardHTML,
    }

    const { systemPrompt, userPrompt } = buildDryRunFixPrompt(
      code, cardSelector, containerSelector, failure, round
    )

    // 调用 AI 修复
    const fixResult = await generateText({
      model: createModel(config),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 3000,
    })

    code = extractCodeFromResponse(fixResult.text)

    // 重新 Dry-Run
    onProgress?.({ round, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "dry-running" })
    dryRunResult = await executeDryRun(code, cardSelector, containerSelector)

    if (dryRunResult.success && dryRunResult.itemCount > 0) {
      onProgress?.({ round, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "success", dryRunResult })
      return { code, dryRunResult, fixRounds: round }
    }
  }

  // 耗尽所有修复轮次
  onProgress?.({ round: MAX_AUTO_FIX_ROUNDS, maxRounds: MAX_AUTO_FIX_ROUNDS, status: "failed", dryRunResult })
  return { code, dryRunResult, fixRounds: MAX_AUTO_FIX_ROUNDS }
}
