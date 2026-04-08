import { useState, useEffect, useCallback, useRef } from "react"
import type {
  FieldMapping,
  ElementCapture,
  AIFieldCandidate,
  AIAnalysisResult,
  PaginationConfig,
  SmartPickerStep,
  AutoFixProgress,
  DryRunResult,
} from "../../lib/types"
import { getAIConfig } from "../../lib/storage/settings"
import { analyzeElement, analyzeNextButton, generateAndDryRun } from "../../lib/ai/client"

interface Props {
  scriptId?: string
  onGenerate: (
    fields: FieldMapping[],
    code: string,
    name: string,
    urlPatterns: string[],
    pagination?: PaginationConfig,
    cardSelector?: string,
    containerSelector?: string,
    dryRunResult?: DryRunResult
  ) => void
  onCancel: () => void
}

export function ElementPicker({ scriptId, onGenerate, onCancel }: Props) {
  const [step, setStep] = useState<SmartPickerStep>({ step: "select" })
  const [isSelectingCard, setIsSelectingCard] = useState(false)
  const [isSelectingPagination, setIsSelectingPagination] = useState(false)
  const selectingTargetRef = useRef<"card" | "pagination">("card")
  const stepRef = useRef<SmartPickerStep>(step)
  stepRef.current = step
  const [pageUrl, setPageUrl] = useState("")
  const [error, setError] = useState("")
  const [generating, setGenerating] = useState(false)
  const [autoFixProgress, setAutoFixProgress] = useState<AutoFixProgress | null>(null)
  const dryRunCancelRef = useRef({ cancelled: false })
  // 暂存「先选翻页」时的 AI 分析结果
  const pendingPaginationRef = useRef<PaginationConfig | null>(null)
  // 翻页元素分析中状态
  const [analyzingPagination, setAnalyzingPagination] = useState(false)

  // 获取当前页面 URL
  useEffect(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.url) setPageUrl(tab.url)
    })
  }, [])

  // 组件卸载时关闭 picker
  useEffect(() => {
    return () => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
        }
      })
    }
  }, [])

  // 停止当前 picker
  const stopPicker = useCallback(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
      }
    })
    setIsSelectingCard(false)
    setIsSelectingPagination(false)
  }, [])

  // 切换卡片选择模式
  const toggleSelectingCard = useCallback(() => {
    if (isSelectingCard) {
      stopPicker()
      return
    }
    setIsSelectingPagination(false)
    selectingTargetRef.current = "card"
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" })
      setIsSelectingCard(true)
    })
  }, [isSelectingCard, stopPicker])

  // 切换翻页选择模式
  const toggleSelectingPagination = useCallback(() => {
    if (isSelectingPagination) {
      stopPicker()
      return
    }
    setIsSelectingCard(false)
    selectingTargetRef.current = "pagination"
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" })
      setIsSelectingPagination(true)
    })
  }, [isSelectingPagination, stopPicker])

  // 监听元素选中
  useEffect(() => {
    const handler = (e: Event) => {
      const capture = (e as CustomEvent).detail as ElementCapture

      // 停止 picker
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
        }
      })

      const currentStep = stepRef.current

      // 翻页元素选择
      if (selectingTargetRef.current === "pagination") {
        setIsSelectingPagination(false)
        setIsSelectingCard(false)

        if (currentStep.step === "select") {
          // 在 select 步骤选了翻页元素，留在 select，后台分析
          setStep({ ...currentStep, paginationCapture: capture })
          handleAnalyzePagination(capture)
          return
        }

        if (currentStep.step === "confirm") {
          // 在 confirm 步骤选了翻页元素，内联更新
          updatePaginationFromCapture(currentStep, capture)
          return
        }
        return
      }

      // 卡片元素选择
      setIsSelectingCard(false)
      setIsSelectingPagination(false)

      const paginationCapture =
        currentStep.step === "select"
          ? currentStep.paginationCapture
          : currentStep.step === "analyzing"
            ? currentStep.paginationCapture
            : undefined

      setStep({ step: "analyzing", capture, paginationCapture })
      handleAnalyze(capture, paginationCapture)
    }
    window.addEventListener("pagepilot-element-selected", handler)
    return () => window.removeEventListener("pagepilot-element-selected", handler)
  }, [])

  // AI 分析翻页按钮（select 阶段后台运行）
  const handleAnalyzePagination = async (capture: ElementCapture) => {
    setAnalyzingPagination(true)
    setError("")
    try {
      const config = await getAIConfig()
      const result = await analyzeNextButton(config, capture)

      const isNumbered = result.paginationType === "numbered"
      pendingPaginationRef.current = {
        enabled: true,
        mode: isNumbered ? "numbered" : "click",
        nextButtonSelector: isNumbered ? (result.pageButtonSelector || result.nextButtonSelector) : capture.selector,
        ...(isNumbered && result.pageButtonSelector ? { pageButtonSelector: result.pageButtonSelector } : {}),
        maxPages: result.totalPagesHint || 5,
        waitMs: 2000,
        nextButtonCapture: capture,
      }
    } catch (err: any) {
      // 分析失败也保存基础配置
      pendingPaginationRef.current = {
        enabled: true,
        mode: "click",
        nextButtonSelector: capture.selector,
        maxPages: 5,
        waitMs: 2000,
        nextButtonCapture: capture,
      }
    } finally {
      setAnalyzingPagination(false)
    }
  }

  // AI 分析卡片元素
  const handleAnalyze = async (capture: ElementCapture, paginationCapture?: ElementCapture) => {
    setError("")
    try {
      const config = await getAIConfig()
      const analysis = await analyzeElement(config, capture)

      const fields: AIFieldCandidate[] = analysis.fields.map((f) => ({
        ...f,
        enabled: true,
      })) as AIFieldCandidate[]

      // 如果有暂存的分页配置，附带过去
      const pagination = pendingPaginationRef.current || undefined
      pendingPaginationRef.current = null

      setStep({ step: "confirm", capture, analysis, fields, pagination })
    } catch (err: any) {
      setError(err?.message || "AI 分析失败")
      setStep({ step: "select", paginationCapture })
    }
  }

  // 在 confirm 步骤更新翻页配置
  const updatePaginationFromCapture = async (
    currentStep: Extract<typeof currentStep, { step: "confirm" }>,
    capture: ElementCapture
  ) => {
    setError("")
    try {
      const config = await getAIConfig()
      const result = await analyzeNextButton(config, capture)

      const isNumbered = result.paginationType === "numbered"
      const pagination: PaginationConfig = {
        enabled: true,
        mode: isNumbered ? "numbered" : "click",
        nextButtonSelector: isNumbered ? (result.pageButtonSelector || result.nextButtonSelector) : capture.selector,
        ...(isNumbered && result.pageButtonSelector ? { pageButtonSelector: result.pageButtonSelector } : {}),
        maxPages: result.totalPagesHint || currentStep.pagination?.maxPages || 5,
        waitMs: currentStep.pagination?.waitMs || 2000,
        nextButtonCapture: capture,
      }
      setStep({ ...currentStep, pagination })
    } catch (err: any) {
      setError(err?.message || "翻页按钮分析失败")
    }
  }

  // 切换字段开关
  const toggleField = (index: number) => {
    if (step.step !== "confirm") return
    const newFields = [...step.fields]
    newFields[index] = { ...newFields[index], enabled: !(newFields[index] as any).enabled }
    setStep({ ...step, fields: newFields })
  }

  // 修改字段名
  const renameField = (index: number, name: string) => {
    if (step.step !== "confirm") return
    const newFields = [...step.fields]
    newFields[index] = { ...newFields[index], name }
    setStep({ ...step, fields: newFields })
  }

  // 生成脚本（含 Dry-Run + 自动修复）
  const handleGenerate = async () => {
    if (step.step !== "confirm") return
    setError("")
    setGenerating(true)
    setAutoFixProgress(null)
    dryRunCancelRef.current = { cancelled: false }

    try {
      const config = await getAIConfig()
      const enabledFields = step.fields.filter((f) => (f as any).enabled !== false)

      const result = await generateAndDryRun(
        config,
        enabledFields,
        step.analysis.cardSelector,
        step.analysis.containerSelector,
        step.pagination,
        (progress) => setAutoFixProgress(progress),
        dryRunCancelRef.current
      )

      const urlObj = new URL(pageUrl)
      const defaultPattern = `${urlObj.hostname}/*`

      const fieldMappings: FieldMapping[] = enabledFields.map((f) => ({
        name: f.name,
        selector: f.selector,
        attribute: f.attribute,
      }))

      onGenerate(
        fieldMappings,
        result.code,
        "",
        [defaultPattern],
        step.pagination,
        step.analysis.cardSelector,
        step.analysis.containerSelector,
        result.dryRunResult
      )
    } catch (err: any) {
      setError(err?.message || "生成失败")
    } finally {
      setGenerating(false)
      setAutoFixProgress(null)
    }
  }

  // 启用/禁用分页
  const togglePagination = () => {
    if (step.step !== "confirm") return
    if (step.pagination) {
      // 禁用分页
      setStep({ ...step, pagination: undefined })
    } else {
      // 启用分页（默认配置）
      const hintType = step.analysis.paginationHint?.type
      const isNumbered = hintType === "numbered"
      setStep({
        ...step,
        pagination: {
          enabled: true,
          mode: isNumbered ? "numbered" : "click",
          nextButtonSelector: step.analysis.paginationHint?.nextButtonSelector || "",
          ...(isNumbered && step.analysis.paginationHint?.pageButtonSelector
            ? { pageButtonSelector: step.analysis.paginationHint.pageButtonSelector }
            : {}),
          maxPages: step.analysis.paginationHint?.estimatedPages || 5,
          waitMs: 2000,
        },
      })
    }
  }

  // 渲染置信度徽章
  const renderConfidence = (confidence: string) => {
    const colors: Record<string, string> = {
      high: "text-primary bg-primary/10",
      medium: "text-amber bg-amber/10",
      low: "text-red bg-red/10",
    }
    const labels: Record<string, string> = { high: "高", medium: "中", low: "低" }
    return (
      <span className={`text-[9px] px-1 py-0.5 rounded ${colors[confidence] || colors.medium}`}>
        {labels[confidence] || confidence}
      </span>
    )
  }

  // 获取 select 步骤的 paginationCapture
  const selectPaginationCapture =
    step.step === "select" ? step.paginationCapture :
    step.step === "analyzing" ? step.paginationCapture :
    undefined

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">
            {step.step === "select" && "选择元素"}
            {step.step === "analyzing" && "AI 分析中"}
            {step.step === "confirm" && "确认字段"}
          </span>
        </div>
        <span className="text-[10px] text-amber">
          {step.step === "select" && "双选模式"}
          {step.step === "analyzing" && "分析中"}
          {step.step === "confirm" && "确认配置"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 错误提示 */}
        {error && (
          <div className="bg-red/10 border border-red/20 rounded-lg p-2 text-[11px] text-red">
            {error}
          </div>
        )}

        {/* ===== select 步骤 ===== */}
        {step.step === "select" && (
          <div className="space-y-2">
            {/* 卡片选择 */}
            <div className="space-y-1">
              <div className="text-[10px] text-text-muted">卡片元素 (必选)</div>
              <button
                onClick={toggleSelectingCard}
                className={`w-full py-2.5 rounded-lg text-[11px] font-bold border transition-all ${
                  isSelectingCard
                    ? "border-primary text-primary bg-primary/10 shadow-[0_0_12px_rgba(0,255,136,0.15)]"
                    : "border-white/10 text-text-muted bg-bg-elevated hover:border-primary/40 hover:text-primary"
                }`}
              >
                {isSelectingCard ? "⊙ 选择模式已开启 — 点击页面元素" : "＋ 点击选择卡片元素"}
              </button>
            </div>

            {/* 翻页选择 */}
            <div className="space-y-1">
              <div className="text-[10px] text-text-muted">翻页元素 (可选)</div>
              <button
                onClick={toggleSelectingPagination}
                className={`w-full py-2.5 rounded-lg text-[11px] font-bold border transition-all ${
                  isSelectingPagination
                    ? "border-amber text-amber bg-amber/10 shadow-[0_0_12px_rgba(255,170,0,0.15)]"
                    : selectPaginationCapture
                      ? "border-amber/30 text-amber bg-amber/5"
                      : "border-white/10 text-text-muted bg-bg-elevated hover:border-amber/40 hover:text-amber"
                }`}
              >
                {isSelectingPagination
                  ? "⊙ 选择模式已开启 — 点击翻页元素"
                  : selectPaginationCapture
                    ? `✓ 已选择: ${selectPaginationCapture.selector}`
                    : "＋ 点击选择翻页元素"}
              </button>
              {selectPaginationCapture && (
                <div className="text-[9px] text-amber/70 px-1">
                  {analyzingPagination ? "AI 分析翻页按钮中..." : "翻页按钮已就绪"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== analyzing 步骤 ===== */}
        {step.step === "analyzing" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-primary">
              <span className="animate-pulse">●</span>
              AI 正在分析元素结构...
            </div>
            <div className="text-[10px] text-text-muted">
              选中元素: <span className="text-blue">{step.capture.selector}</span>
            </div>
            <div className="text-[10px] text-text-muted">
              同级元素数量: {step.capture.siblingCount}
            </div>
          </div>
        )}

        {/* ===== confirm 步骤 ===== */}
        {step.step === "confirm" && (
          <div className="space-y-3">
            {/* 分析摘要 */}
            <div className="bg-bg-elevated border border-white/[0.06] rounded-lg p-2 space-y-1">
              <div className="text-[10px] text-text-muted">
                卡片选择器: <span className="text-blue">{step.analysis.cardSelector}</span>
              </div>
              <div className="text-[10px] text-text-muted">
                容器选择器: <span className="text-blue">{step.analysis.containerSelector}</span>
              </div>
              <div className="text-[10px] text-text-muted">
                识别出 {step.fields.length} 个可提取字段
              </div>
            </div>

            {/* 字段列表 */}
            <div className="space-y-1.5">
              {step.fields.map((field, i) => (
                <div
                  key={i}
                  className={`bg-bg-elevated border rounded-lg p-2 transition-all ${
                    (field as any).enabled !== false
                      ? "border-primary/30"
                      : "border-white/[0.06] opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="checkbox"
                      checked={(field as any).enabled !== false}
                      onChange={() => toggleField(i)}
                      className="accent-primary"
                    />
                    <input
                      value={field.name}
                      onChange={(e) => renameField(i, e.target.value)}
                      className="flex-1 bg-transparent text-[11px] text-text outline-none border-b border-transparent focus:border-primary/40"
                    />
                    {renderConfidence(field.confidence)}
                  </div>
                  <div className="text-[9px] text-text-muted pl-5 space-y-0.5">
                    <div>选择器: {field.selector}</div>
                    <div>属性: {field.attribute}</div>
                    {field.sampleValue && (
                      <div className="truncate">
                        示例: <span className="text-amber">{field.sampleValue}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 分页配置区域 */}
            <div className="border border-white/[0.06] rounded-lg overflow-hidden">
              {/* 分页区域头部 */}
              <button
                onClick={togglePagination}
                className="w-full flex items-center justify-between p-2.5 bg-bg-elevated hover:bg-bg-elevated/80 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${step.pagination ? "text-amber" : "text-text-muted"}`}>
                    {step.pagination ? "●" : "○"}
                  </span>
                  <span className="text-[11px] font-bold text-text-muted">分页配置</span>
                </div>
                <span className="text-[10px] text-text-muted">
                  {step.pagination ? "已启用" : "未启用"}
                </span>
              </button>

              {/* 分页配置内容 */}
              {step.pagination && (
                <div className="p-3 space-y-3 border-t border-white/[0.06]">
                  {/* 选择翻页按钮 */}
                  <div>
                    <div className="text-[10px] text-text-muted mb-1">翻页元素</div>
                    <div className="flex gap-1.5">
                      <input
                        value={step.pagination.nextButtonCapture?.selector || step.pagination.nextButtonSelector}
                        readOnly
                        placeholder="点击右侧按钮选择"
                        className="flex-1 bg-bg border border-white/10 rounded px-2 py-1 text-[11px] text-text-muted outline-none"
                      />
                      <button
                        onClick={toggleSelectingPagination}
                        className={`shrink-0 text-[10px] px-2 py-1 rounded border transition-all ${
                          isSelectingPagination
                            ? "border-amber text-amber bg-amber/10"
                            : "border-white/10 text-text-muted hover:border-amber/40 hover:text-amber"
                        }`}
                      >
                        {isSelectingPagination ? "选择中..." : "重新选择"}
                      </button>
                    </div>
                  </div>

                  {/* 翻页模式 */}
                  <div>
                    <div className="text-[10px] text-text-muted mb-1">翻页模式</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {(["click", "scroll", "url"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() =>
                            setStep({
                              ...step,
                              pagination: { ...step.pagination, mode },
                            })
                          }
                          className={`text-[10px] px-2 py-1 rounded border transition-all ${
                            step.pagination.mode === mode
                              ? "border-primary text-primary bg-primary/10"
                              : "border-white/10 text-text-muted hover:border-white/20"
                          }`}
                        >
                          {mode === "click" ? "点击翻页" : mode === "scroll" ? "滚动加载" : "URL 翻页"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 最大页数 */}
                  <div>
                    <div className="text-[10px] text-text-muted mb-1">最大提取页数</div>
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {[1, 3, 5, 7].map((n) => (
                        <button
                          key={n}
                          onClick={() =>
                            setStep({
                              ...step,
                              pagination: { ...step.pagination, maxPages: n },
                            })
                          }
                          className={`text-[10px] px-2 py-1 rounded border transition-all ${
                            step.pagination.maxPages === n
                              ? "border-primary text-primary bg-primary/10"
                              : "border-white/10 text-text-muted hover:border-white/20"
                          }`}
                        >
                          {n} 页
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if ([1, 3, 5, 7].includes(step.pagination!.maxPages)) {
                            setStep({
                              ...step,
                              pagination: { ...step.pagination, maxPages: 10 },
                            })
                          }
                        }}
                        className={`text-[10px] px-2 py-1 rounded border transition-all ${
                          ![1, 3, 5, 7].includes(step.pagination!.maxPages)
                            ? "border-primary text-primary bg-primary/10"
                            : "border-white/10 text-text-muted hover:border-white/20"
                        }`}
                      >
                        自定义
                      </button>
                      {![1, 3, 5, 7].includes(step.pagination!.maxPages) && (
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={step.pagination.maxPages}
                          onChange={(e) =>
                            setStep({
                              ...step,
                              pagination: { ...step.pagination, maxPages: parseInt(e.target.value) || 1 },
                            })
                          }
                          className="w-14 bg-bg border border-primary text-primary rounded px-1.5 py-1 text-[10px] text-center outline-none"
                        />
                      )}
                    </div>
                  </div>

                  {/* 等待时间 */}
                  <div>
                    <div className="text-[10px] text-text-muted mb-1">
                      翻页后等待时间: {step.pagination.waitMs}ms
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={5000}
                      step={500}
                      value={step.pagination.waitMs}
                      onChange={(e) =>
                        setStep({
                          ...step,
                          pagination: { ...step.pagination, waitMs: parseInt(e.target.value) },
                        })
                      }
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 分页提示（AI 自动检测到但未启用时） */}
            {!step.pagination && step.analysis.paginationHint && (
              <div className="bg-blue/10 border border-blue/20 rounded-lg p-2">
                <div className="text-[10px] text-blue font-medium">
                  检测到分页
                  {step.analysis.paginationHint.estimatedPages &&
                    `（约 ${step.analysis.paginationHint.estimatedPages} 页）`}
                </div>
                <button
                  onClick={togglePagination}
                  className="mt-1 text-[10px] text-blue hover:underline"
                >
                  启用分页提取 →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-center text-[11px] text-text-muted py-2 border border-white/[0.08] rounded hover:bg-white/[0.03]"
        >
          取消
        </button>

        {step.step === "select" && (
          <button
            disabled
            className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold opacity-50"
          >
            请先选择元素
          </button>
        )}

        {step.step === "analyzing" && (
          <button
            disabled
            className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold opacity-50"
          >
            分析中...
          </button>
        )}

        {step.step === "confirm" && (
          <>
            {generating && autoFixProgress && autoFixProgress.round > 0 && (
              <button
                onClick={() => { dryRunCancelRef.current.cancelled = true }}
                className="text-[10px] text-red px-2 py-1"
              >
                跳过
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-70 transition-all"
            >
              {generating ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="animate-pulse">●</span>
                  {autoFixProgress?.status === "dry-running" && "Dry-Run 验证中..."}
                  {autoFixProgress?.status === "fixing" && `自动修复 (${autoFixProgress.round}/${autoFixProgress.maxRounds})...`}
                  {autoFixProgress?.status === "generating" && "AI 生成中..."}
                  {(!autoFixProgress || autoFixProgress.status === "success" || autoFixProgress.status === "failed") && "AI 生成中..."}
                </span>
              ) : (
                step.pagination?.enabled ? "生成分页脚本 →" : "生成脚本 →"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
