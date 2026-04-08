import { useState, useEffect } from "react"
import type { ExtractionResult, FieldMapping, PaginationConfig, DryRunResult } from "../../lib/types"
import { getAIConfig } from "../../lib/storage/settings"
import { optimizeScript, type OptimizeScriptResult } from "../../lib/ai/client"
import { FieldList } from "../components/FieldList"

interface Props {
  scriptId?: string
  tempScript: {
    name: string
    urlPatterns: string[]
    fields: FieldMapping[]
    code: string
    pagination?: PaginationConfig
    cardSelector?: string
    containerSelector?: string
  }
  autoOpenOptimize?: boolean
  executionResult?: Record<string, any>[]
  onSave: () => void
  onExecute: (result: ExtractionResult, editContext?: { scriptId?: string; tempScript: any }) => void
  onCancel: () => void
  dryRunResult?: DryRunResult
}

export function ScriptPreview({ scriptId, tempScript, autoOpenOptimize, executionResult, dryRunResult, onSave, onExecute, onCancel }: Props) {
  const [name, setName] = useState(tempScript.name || "新脚本")
  const [urlPatterns, setUrlPatterns] = useState(tempScript.urlPatterns.join("\n"))
  const [code, setCode] = useState(tempScript.code)
  const [executing, setExecuting] = useState(false)
  const [optimizeOpen, setOptimizeOpen] = useState(autoOpenOptimize || false)
  const [optimizeInput, setOptimizeInput] = useState("")
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState("")
  const [animating, setAnimating] = useState(!scriptId) // 新建脚本时播放动画
  const [optimizeHistory, setOptimizeHistory] = useState<
    Array<{ requirement: string; response: string; timestamp: number }>
  >([])
  const [pagination, setPagination] = useState<PaginationConfig | undefined>(tempScript.pagination)

  // 如果 autoOpenOptimize 变化，展开优化面板
  useEffect(() => {
    if (autoOpenOptimize) setOptimizeOpen(true)
  }, [autoOpenOptimize])

  // 动画结束后清除标记
  useEffect(() => {
    if (animating) {
      const timer = setTimeout(() => setAnimating(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [animating])

  const handleSave = async () => {
    const { saveScript, getScript } = await import("../../lib/storage/scripts")
    const id = scriptId || crypto.randomUUID()
    const existing = scriptId ? await getScript(scriptId) : null
    await saveScript({
      id,
      name: name.trim() || "未命名脚本",
      urlPatterns: urlPatterns.split("\n").filter(Boolean),
      fields: tempScript.fields,
      code,
      createdAt: existing?.createdAt || Date.now(),
      lastExecutedAt: existing?.lastExecutedAt,
      pagination,
      cardSelector: tempScript.cardSelector,
      containerSelector: tempScript.containerSelector,
    })
    onSave()
  }

  const handleSaveAndExecute = async () => {
    setExecuting(true)
    const start = Date.now()
    try {
      // 通过 Background 执行，避免 CSP 限制
      const response = await chrome.runtime.sendMessage({
        type: "EXECUTE_IN_MAIN",
        payload: { code },
      })

      if (response?.error) {
        console.error("脚本执行失败:", response.error)
        return
      }

      const data = response?.result || []
      const duration = Date.now() - start

      onExecute(
        {
          scriptId: scriptId || "",
          data: Array.isArray(data) ? data : [data],
          executedAt: Date.now(),
          duration,
          count: Array.isArray(data) ? data.length : 1,
        },
        {
          scriptId,
          tempScript: {
            name: name.trim() || "未命名脚本",
            urlPatterns: urlPatterns.split("\n").filter(Boolean),
            fields: tempScript.fields,
            code,
            pagination,
            cardSelector: tempScript.cardSelector,
            containerSelector: tempScript.containerSelector,
          },
        }
      )
    } catch (error) {
      console.error("脚本执行失败:", error)
    } finally {
      setExecuting(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code)
  }

  const handleOptimize = async () => {
    const requirement = optimizeInput.trim()
    if (!requirement || optimizing) return
    setOptimizing(true)
    setOptimizeError("")
    try {
      const config = await getAIConfig()
      const result = await optimizeScript(config, code, requirement, executionResult)
      setCode(result.code)
      setOptimizeHistory((prev) => [
        ...prev,
        { requirement, response: result.rawResponse, timestamp: Date.now() },
      ])
      setOptimizeInput("")
    } catch (err: any) {
      setOptimizeError(err?.message || "优化失败")
    } finally {
      setOptimizing(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">脚本预览</span>
        </div>
        <span className="text-[10px] text-primary">保存脚本</span>
      </div>

      <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${animating ? "script-land-enter" : ""}`}>
        {/* 脚本名称 */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">脚本名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-elevated border border-white/10 rounded px-2 py-1.5 text-xs text-text outline-none focus:border-primary"
          />
        </div>

        {/* URL Pattern */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">
            URL 匹配规则（每行一个）
          </label>
          <textarea
            value={urlPatterns}
            onChange={(e) => setUrlPatterns(e.target.value)}
            placeholder="example.com/*"
            rows={2}
            className="w-full bg-bg-elevated border border-white/10 rounded px-2 py-1.5 text-xs text-text placeholder-text-muted outline-none focus:border-primary resize-none"
          />
        </div>

        {/* 选择器信息 */}
        {(tempScript.cardSelector || tempScript.containerSelector) && (
          <div className="bg-bg-elevated border border-white/[0.06] rounded-lg p-2 space-y-1">
            <div className="text-[10px] text-text-muted">
              卡片选择器: <span className="text-blue">{tempScript.cardSelector || "-"}</span>
            </div>
            <div className="text-[10px] text-text-muted">
              容器选择器: <span className="text-blue">{tempScript.containerSelector || "-"}</span>
            </div>
          </div>
        )}

        {/* Dry-Run 结果 */}
        {dryRunResult && (
          <div className={`rounded-lg p-2 border ${
            dryRunResult.success
              ? "bg-primary/5 border-primary/20"
              : "bg-amber/5 border-amber/20"
          }`}>
            <div className={`text-[10px] font-medium ${
              dryRunResult.success ? "text-primary" : "text-amber"
            }`}>
              {dryRunResult.success
                ? `✓ Dry-Run 通过 (${dryRunResult.itemCount} 条数据)`
                : `⚠ Dry-Run 未通过: ${dryRunResult.error || "返回空数据"}`
              }
            </div>
            {!dryRunResult.success && (
              <div className="text-[9px] text-text-muted mt-1">
                脚本已尝试自动修复。如果执行结果不理想，可使用下方"AI 优化"手动调整。
              </div>
            )}
          </div>
        )}

        {/* 分页配置 - 开启按钮 */}
        {!pagination?.enabled && (
          <button
            onClick={() =>
              setPagination({
                enabled: true,
                mode: "click",
                nextButtonSelector: "",
                maxPages: 3,
                waitMs: 2000,
              })
            }
            className="w-full flex items-center justify-between p-2 border border-white/[0.06] rounded-lg hover:bg-white/[0.02] transition-colors"
          >
            <span className="text-[10px] text-text-muted">分页提取</span>
            <span className="text-[9px] text-blue">+ 开启</span>
          </button>
        )}

        {/* 分页配置 */}
        {pagination?.enabled && (
          <div className="bg-bg-elevated border border-blue/20 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-blue font-medium">分页提取</div>
              <button
                onClick={() => setPagination(undefined)}
                className="text-[9px] text-red hover:text-red/80"
              >
                关闭分页
              </button>
            </div>

            {/* 翻页模式 */}
            <div>
              <div className="text-[10px] text-text-muted mb-1">翻页模式</div>
              <div className="flex gap-1.5">
                {(["click", "scroll", "url"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPagination({ ...pagination, mode })}
                    className={`text-[10px] px-2 py-1 rounded border transition-all ${
                      pagination.mode === mode
                        ? "border-blue text-blue bg-blue/10"
                        : "border-white/10 text-text-muted hover:border-white/20"
                    }`}
                  >
                    {mode === "click" ? "点击翻页" : mode === "numbered" ? "数字分页" : mode === "scroll" ? "滚动加载" : "URL 翻页"}
                  </button>
                ))}
              </div>
            </div>

            {/* 下一页按钮选择器 */}
            {pagination.mode === "click" && (
              <div>
                <div className="text-[10px] text-text-muted mb-1">下一页按钮选择器</div>
                <input
                  value={pagination.nextButtonSelector}
                  onChange={(e) => setPagination({ ...pagination, nextButtonSelector: e.target.value })}
                  placeholder="输入 CSS 选择器"
                  className="w-full bg-bg border border-white/10 rounded px-2 py-1 text-[11px] text-text placeholder-text-muted outline-none focus:border-blue"
                />
              </div>
            )}

            {/* 页码按钮选择器（数字分页模式） */}
            {pagination.mode === "numbered" && (
              <div>
                <div className="text-[10px] text-text-muted mb-1">页码按钮选择器</div>
                <input
                  value={pagination.pageButtonSelector || ""}
                  onChange={(e) => setPagination({ ...pagination, pageButtonSelector: e.target.value })}
                  placeholder="如 .pagination .page-item"
                  className="w-full bg-bg border border-white/10 rounded px-2 py-1 text-[11px] text-text placeholder-text-muted outline-none focus:border-blue"
                />
                <div className="text-[9px] text-text-muted mt-1">
                  匹配所有页码按钮的通用 CSS 选择器
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
                    onClick={() => setPagination({ ...pagination, maxPages: n })}
                    className={`text-[10px] px-2 py-1 rounded border transition-all ${
                      pagination.maxPages === n
                        ? "border-blue text-blue bg-blue/10"
                        : "border-white/10 text-text-muted hover:border-white/20"
                    }`}
                  >
                    {n} 页
                  </button>
                ))}
                <button
                  onClick={() => {
                    if ([1, 3, 5, 7].includes(pagination.maxPages)) {
                      setPagination({ ...pagination, maxPages: 10 })
                    }
                  }}
                  className={`text-[10px] px-2 py-1 rounded border transition-all ${
                    ![1, 3, 5, 7].includes(pagination.maxPages)
                      ? "border-blue text-blue bg-blue/10"
                      : "border-white/10 text-text-muted hover:border-white/20"
                  }`}
                >
                  自定义
                </button>
                {![1, 3, 5, 7].includes(pagination.maxPages) && (
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pagination.maxPages}
                    onChange={(e) =>
                      setPagination({ ...pagination, maxPages: Math.max(1, Math.min(100, parseInt(e.target.value) || 1)) })
                    }
                    className="w-14 bg-bg border border-blue text-blue rounded px-1.5 py-1 text-[10px] text-center outline-none"
                  />
                )}
              </div>
            </div>

            {/* 等待时间 */}
            <div>
              <div className="text-[10px] text-text-muted mb-1">
                翻页后等待时间: {pagination.waitMs}ms
              </div>
              <input
                type="range"
                min={500}
                max={5000}
                step={500}
                value={pagination.waitMs}
                onChange={(e) =>
                  setPagination({ ...pagination, waitMs: parseInt(e.target.value) })
                }
                className="w-full accent-blue"
              />
            </div>
          </div>
        )}

        {/* 字段映射 */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">
            字段映射 ({tempScript.fields.length} 个)
          </label>
          <FieldList fields={tempScript.fields} onRemove={() => {}} animated={animating} />
        </div>

        {/* 代码预览 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] text-text-muted">生成代码</label>
            <button
              onClick={handleCopyCode}
              className="text-[9px] text-text-muted hover:text-text"
            >
              复制
            </button>
          </div>
          <div className={`bg-bg-elevated border border-primary/20 rounded-lg overflow-hidden ${animating ? "script-land-code" : ""}`}>
            <div className="p-0.5 bg-primary/5 border-b border-primary/10 px-2">
              <span className="text-[9px] text-primary">提取脚本</span>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={10}
              className="w-full bg-transparent p-2 text-[10px] text-text-muted font-mono leading-relaxed outline-none resize-y"
            />
          </div>
        </div>

        {/* AI 优化面板 */}
        <div className="border border-white/[0.06] rounded-lg overflow-hidden">
          <button
            onClick={() => setOptimizeOpen(!optimizeOpen)}
            className="w-full flex items-center justify-between p-2 text-left hover:bg-white/[0.02] transition-colors"
          >
            <span className="text-[10px] text-amber font-medium">✨ AI 优化脚本</span>
            <span className="text-[9px] text-text-muted">{optimizeOpen ? "收起" : "展开"}</span>
          </button>
          {optimizeOpen && (
            <div className="px-2 pb-2 space-y-2 border-t border-white/[0.06]">
              <textarea
                value={optimizeInput}
                onChange={(e) => setOptimizeInput(e.target.value)}
                placeholder="描述优化需求，如：添加价格字段、修复空值问题、提取更多数据..."
                rows={2}
                className="w-full bg-bg border border-white/10 rounded px-2 py-1.5 text-[10px] text-text placeholder-text-muted outline-none focus:border-amber/40 resize-none mt-2"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleOptimize()
                }}
              />
              {optimizeError && (
                <div className="text-[9px] text-red bg-red/10 border border-red/20 rounded px-2 py-1">
                  {optimizeError}
                </div>
              )}
              <button
                onClick={handleOptimize}
                disabled={optimizing || !optimizeInput.trim()}
                className="w-full text-center text-[10px] py-1.5 rounded font-medium transition-all disabled:opacity-40 bg-amber/10 text-amber border border-amber/20 hover:bg-amber/20"
              >
                {optimizing ? "AI 优化中..." : "优化脚本"}
              </button>
              <div className="text-[8px] text-text-muted text-center">Ctrl + Enter 快捷发送</div>

              {/* AI 优化历史 */}
              {optimizeHistory.length > 0 && (
                <div className="space-y-2 mt-1">
                  <div className="text-[9px] text-text-muted font-medium">优化记录</div>
                  {[...optimizeHistory].reverse().map((item, i) => (
                    <details
                      key={item.timestamp}
                      className="bg-bg border border-white/[0.06] rounded group"
                      open={i === 0}
                    >
                      <summary className="text-[9px] text-amber/80 px-2 py-1 cursor-pointer hover:bg-white/[0.02] flex items-center justify-between">
                        <span className="truncate flex-1 mr-2">{item.requirement}</span>
                        <span className="text-[8px] text-text-muted shrink-0">
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </summary>
                      <div className="px-2 pb-2 text-[9px] text-text-muted leading-relaxed whitespace-pre-wrap border-t border-white/[0.06] pt-1.5 max-h-40 overflow-y-auto">
                        {item.response}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 底部 */}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-center text-[11px] text-text-muted py-2 border border-white/[0.08] rounded hover:bg-white/[0.03]"
        >
          返回编辑
        </button>
        <button
          onClick={handleSave}
          className="flex-1 text-center text-[11px] text-text-muted py-2 border border-primary/30 rounded hover:bg-primary/5"
        >
          保存脚本
        </button>
        <button
          onClick={handleSaveAndExecute}
          disabled={executing}
          className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {executing ? "执行中..." : "执行"}
        </button>
      </div>
    </div>
  )
}
