import { useState, useCallback } from "react"
import type { ClaudeCodeResult } from "../../lib/types"
import { DataTable } from "../components/DataTable"

interface Props {
  result: ClaudeCodeResult
  onNewRequest: () => void
  onBack: () => void
}

/** 检测输出类型并解析 */
function parseOutput(output: string):
  | { type: "table"; data: Record<string, any>[] }
  | { type: "object"; data: Record<string, any> }
  | { type: "markdown"; content: string } {
  const trimmed = output.trim()

  // 尝试解析为 JSON 数组
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      return { type: "table", data: parsed }
    }
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return { type: "object", data: parsed }
    }
  } catch {
    // 不是 JSON，作为 Markdown
  }

  return { type: "markdown", content: trimmed }
}

export function ClaudeCodeResultView({ result, onNewRequest, onBack }: Props) {
  const [copied, setCopied] = useState(false)
  const parsed = parseOutput(result.output)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(result.output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [result.output])

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">CC 结果</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-primary">
            {result.action === "invoke_skill" ? `Skill: ${result.skill}` : "Prompt"}
          </span>
          <span className="text-[10px] text-text-muted">{result.duration}ms</span>
        </div>
      </div>

      {/* 统计 */}
      <div className="flex gap-2 p-3">
        <div className="flex-1 bg-primary/5 rounded p-2 text-center">
          <div className="text-sm font-bold text-primary">
            {(result.output.length / 1024).toFixed(1)}K
          </div>
          <div className="text-[9px] text-text-muted">字符</div>
        </div>
        <div className="flex-1 bg-blue/5 rounded p-2 text-center">
          <div className="text-sm font-bold text-blue">{result.duration}</div>
          <div className="text-[9px] text-text-muted">ms</div>
        </div>
        <div className="flex-1 bg-amber/5 rounded p-2 text-center">
          <div className="text-sm font-bold text-amber">
            {parsed.type === "table" ? "表格" : parsed.type === "object" ? "JSON" : "文本"}
          </div>
          <div className="text-[9px] text-text-muted">格式</div>
        </div>
      </div>

      {/* 结果内容 */}
      <div className="flex-1 overflow-y-auto p-3">
        {result.error ? (
          <div className="text-[11px] text-red bg-red/10 border border-red/20 rounded p-3">
            {result.error}
          </div>
        ) : parsed.type === "table" ? (
          <DataTable data={parsed.data} />
        ) : parsed.type === "object" ? (
          <div className="space-y-1">
            {Object.entries(parsed.data).map(([key, val]) => (
              <div key={key} className="flex gap-2 text-[11px]">
                <span className="text-text-muted min-w-[100px]">{key}</span>
                <span className="text-text">
                  {typeof val === "object" ? JSON.stringify(val) : String(val)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="text-[11px] text-text whitespace-pre-wrap break-words font-mono leading-relaxed">
            {parsed.content}
          </pre>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex gap-2 p-3 border-t border-white/[0.06]">
        <button
          onClick={handleCopy}
          className="flex-1 text-xs text-text-muted bg-white/[0.04] py-2 rounded hover:bg-white/[0.08]"
        >
          {copied ? "已复制 ✓" : "复制"}
        </button>
        <button
          onClick={onNewRequest}
          className="flex-1 text-xs text-primary bg-primary/10 py-2 rounded hover:bg-primary/20"
        >
          新请求
        </button>
        <button
          onClick={onBack}
          className="flex-1 text-xs text-text-muted bg-white/[0.04] py-2 rounded hover:bg-white/[0.08]"
        >
          返回
        </button>
      </div>
    </div>
  )
}
