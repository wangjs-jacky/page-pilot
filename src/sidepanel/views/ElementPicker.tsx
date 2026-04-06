import { useState, useEffect, useCallback, useRef } from "react"
import type {
  FieldMapping,
  ElementCapture,
  AIFieldCandidate,
  AIAnalysisResult,
  PaginationConfig,
  SmartPickerStep,
} from "../../lib/types"
import { getAIConfig } from "../../lib/storage/settings"
import { analyzeElement, generateSmartScript } from "../../lib/ai/client"
import { extractCodeFromResponse } from "../../lib/ai/prompt-builder"

interface Props {
  scriptId?: string
  onGenerate: (
    fields: FieldMapping[],
    code: string,
    name: string,
    urlPatterns: string[],
    pagination?: PaginationConfig,
    cardSelector?: string,
    containerSelector?: string
  ) => void
  onCancel: () => void
}

export function ElementPicker({ scriptId, onGenerate, onCancel }: Props) {
  const [step, setStep] = useState<SmartPickerStep>({ step: "select" })
  const [isSelecting, setIsSelecting] = useState(false)
  const [isSelectingNextBtn, setIsSelectingNextBtn] = useState(false)
  const selectingNextBtnRef = useRef(false)
  const stepRef = useRef<SmartPickerStep>(step)
  stepRef.current = step
  const [pageUrl, setPageUrl] = useState("")
  const [error, setError] = useState("")
  const [generating, setGenerating] = useState(false)

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

  // 切换选择模式
  const toggleSelecting = useCallback(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (!tab?.id) return
      if (!isSelecting) {
        chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" })
        setIsSelecting(true)
      } else {
        chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
        setIsSelecting(false)
      }
    })
  }, [isSelecting])

  // 监听元素选中（用 ref 避免闭包过期问题，不依赖任何 state）
  useEffect(() => {
    const handler = (e: Event) => {
      const capture = (e as CustomEvent).detail as ElementCapture

      // 停止 picker
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
        }
      })

      // 用 ref 读取最新值，判断是"选分页按钮"还是"选卡片"
      if (selectingNextBtnRef.current) {
        setIsSelectingNextBtn(false)
        setIsSelecting(false)
        const currentStep = stepRef.current
        if (currentStep.step === "configure-pagination") {
          setStep({
            ...currentStep,
            pagination: { ...currentStep.pagination, nextButtonSelector: capture.selector },
          })
        }
        return
      }

      // 正常选卡片流程
      setIsSelecting(false)
      setStep({ step: "analyzing", capture })
      handleAnalyze(capture)
    }
    window.addEventListener("pagepilot-element-selected", handler)
    return () => window.removeEventListener("pagepilot-element-selected", handler)
  }, [])

  // AI 分析元素
  const handleAnalyze = async (capture: ElementCapture) => {
    setError("")
    try {
      const config = await getAIConfig()
      const analysis = await analyzeElement(config, capture)

      // 初始化字段列表（全部启用）
      const fields: AIFieldCandidate[] = analysis.fields.map((f) => ({
        ...f,
        enabled: true,
      })) as AIFieldCandidate[]

      setStep({ step: "confirm", capture, analysis, fields })
    } catch (err: any) {
      setError(err?.message || "AI 分析失败")
      // 回退到选择阶段
      setStep({ step: "select" })
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

  // 生成脚本
  const handleGenerate = async (
    fields: AIFieldCandidate[],
    analysis: AIAnalysisResult,
    pagination?: PaginationConfig
  ) => {
    setError("")
    setGenerating(true)
    try {
      const config = await getAIConfig()
      const enabledFields = fields.filter((f) => (f as any).enabled !== false)

      const response = await generateSmartScript(
        config,
        enabledFields,
        analysis.cardSelector,
        analysis.containerSelector,
        pagination
      )
      const code = extractCodeFromResponse(response)

      const urlObj = new URL(pageUrl)
      const defaultPattern = `${urlObj.hostname}/*`

      const fieldMappings: FieldMapping[] = enabledFields.map((f) => ({
        name: f.name,
        selector: f.selector,
        attribute: f.attribute,
      }))

      onGenerate(
        fieldMappings,
        code,
        "",
        [defaultPattern],
        pagination,
        analysis.cardSelector,
        analysis.containerSelector
      )
    } catch (err: any) {
      setError(err?.message || "生成失败")
    } finally {
      setGenerating(false)
    }
  }

  // 配置分页后生成
  const handleGenerateWithPagination = () => {
    if (step.step !== "configure-pagination") return
    handleGenerate(step.fields, step.analysis, step.pagination)
  }

  // 直接生成（无分页）
  const handleGenerateDirect = () => {
    if (step.step !== "confirm") return
    handleGenerate(step.fields, step.analysis)
  }

  // 进入分页配置
  const goToPaginationConfig = () => {
    if (step.step !== "confirm") return
    const { analysis } = step
    const defaultPagination: PaginationConfig = {
      enabled: true,
      mode: "click",
      nextButtonSelector: analysis.paginationHint?.nextButtonSelector || "",
      maxPages: analysis.paginationHint?.estimatedPages || 5,
      waitMs: 2000,
    }
    setStep({ ...step, step: "configure-pagination", pagination: defaultPagination })
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
            {step.step === "configure-pagination" && "配置分页"}
          </span>
        </div>
        <span className="text-[10px] text-amber">
          {step.step === "select" && "选择元素"}
          {step.step === "analyzing" && "分析中"}
          {step.step === "confirm" && "确认字段"}
          {step.step === "configure-pagination" && "分页配置"}
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
          <button
            onClick={toggleSelecting}
            className={`w-full py-2.5 rounded-lg text-[11px] font-bold border transition-all ${
              isSelecting
                ? "border-primary text-primary bg-primary/10 shadow-[0_0_12px_rgba(0,255,136,0.15)]"
                : "border-white/10 text-text-muted bg-bg-elevated hover:border-primary/40 hover:text-primary"
            }`}
          >
            {isSelecting ? "⊙ 选择模式已开启 — 点击页面元素" : "＋ 点击选择一个卡片元素"}
          </button>
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

            {/* 分页提示 */}
            {step.analysis.paginationHint && (
              <div className="bg-blue/10 border border-blue/20 rounded-lg p-2">
                <div className="text-[10px] text-blue font-medium">
                  检测到分页
                  {step.analysis.paginationHint.estimatedPages &&
                    `（约 ${step.analysis.paginationHint.estimatedPages} 页）`}
                </div>
                <button
                  onClick={goToPaginationConfig}
                  className="mt-1 text-[10px] text-blue hover:underline"
                >
                  配置分页提取 →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== configure-pagination 步骤 ===== */}
        {step.step === "configure-pagination" && (
          <div className="space-y-3">
            <div className="bg-bg-elevated border border-white/[0.06] rounded-lg p-3 space-y-3">
              {/* 翻页模式 */}
              <div>
                <div className="text-[10px] text-text-muted mb-1">翻页模式</div>
                <div className="flex gap-1.5">
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

              {/* 下一页按钮选择器 */}
              {step.pagination.mode === "click" && (
                <div>
                  <div className="text-[10px] text-text-muted mb-1">下一页按钮选择器</div>
                  <div className="flex gap-1.5">
                    <input
                      value={step.pagination.nextButtonSelector}
                      onChange={(e) =>
                        setStep({
                          ...step,
                          pagination: { ...step.pagination, nextButtonSelector: e.target.value },
                        })
                      }
                      placeholder="点击右侧按钮选择或手动输入"
                      className="flex-1 bg-bg border border-white/10 rounded px-2 py-1 text-[11px] text-text placeholder-text-muted outline-none focus:border-primary"
                    />
                    <button
                      onClick={() => {
                        chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
                          if (!tab?.id) return
                          chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" })
                          selectingNextBtnRef.current = true
                          setIsSelectingNextBtn(true)
                          setIsSelecting(true)
                        })
                      }}
                      className={`shrink-0 text-[10px] px-2 py-1 rounded border transition-all ${
                        isSelectingNextBtn
                          ? "border-primary text-primary bg-primary/10"
                          : "border-white/10 text-text-muted hover:border-primary/40 hover:text-primary"
                      }`}
                    >
                      {isSelectingNextBtn ? "选择中..." : "选择"}
                    </button>
                  </div>
                </div>
              )}

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
                      if ([1, 3, 5, 7].includes(step.pagination.maxPages)) {
                        // 切换到自定义模式，设为当前值（非预设值 10 作为起始）
                        setStep({
                          ...step,
                          pagination: { ...step.pagination, maxPages: 10 },
                        })
                      }
                    }}
                    className={`text-[10px] px-2 py-1 rounded border transition-all ${
                      ![1, 3, 5, 7].includes(step.pagination.maxPages)
                        ? "border-primary text-primary bg-primary/10"
                        : "border-white/10 text-text-muted hover:border-white/20"
                    }`}
                  >
                    自定义
                  </button>
                  {![1, 3, 5, 7].includes(step.pagination.maxPages) && (
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

        {step.step === "confirm" && (
          <button
            onClick={handleGenerateDirect}
            disabled={generating}
            className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-70 transition-all"
          >
            {generating ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="animate-pulse">●</span>
                AI 生成中...
              </span>
            ) : (
              "生成脚本 →"
            )}
          </button>
        )}

        {step.step === "configure-pagination" && (
          <button
            onClick={handleGenerateWithPagination}
            disabled={generating}
            className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-70 transition-all"
          >
            {generating ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="animate-pulse">●</span>
                AI 生成中...
              </span>
            ) : (
              "生成带分页脚本 →"
            )}
          </button>
        )}
      </div>
    </div>
  )
}
