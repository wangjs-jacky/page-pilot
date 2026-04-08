import { useState } from "react"
import type { ExtractionScript } from "../../lib/types"

interface Props {
  script: ExtractionScript
  isMatched: boolean
  onExecute: (script: ExtractionScript) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
}

export function ScriptCard({ script, isMatched, onExecute, onEdit, onDelete, onDuplicate }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fieldSummary = script.fields.map((f) => f.name).join(" · ")
  const lastRun = script.lastExecutedAt
    ? new Date(script.lastExecutedAt).toLocaleDateString("zh-CN")
    : "未执行"
  const created = new Date(script.createdAt).toLocaleDateString("zh-CN")

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(script.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }

  const urlDisplay = script.urlPatterns.length > 0
    ? script.urlPatterns[0].replace(/\*/g, "…")
    : "无 URL 匹配"

  return (
    <div
      onClick={() => onEdit(script.id)}
      className={`rounded-lg p-3 border transition-colors cursor-pointer hover:bg-white/[0.04] ${
        isMatched
          ? "bg-primary/5 border-primary/20 hover:bg-primary/10"
          : "bg-white/[0.02] border-white/[0.06]"
      }`}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-bold truncate flex-1">{script.name}</span>
        <div className="flex gap-2 ml-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onExecute(script) }}
            className="text-xs text-primary hover:text-primary/80"
          >
            ▶ 执行
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(script.id) }}
            className="text-xs text-text-muted hover:text-text"
            title="复制脚本"
          >
            ⧉
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteClick() }}
            onBlur={() => setConfirmDelete(false)}
            className={`text-xs ${confirmDelete ? "text-red font-bold" : "text-text-muted hover:text-red"}`}
          >
            {confirmDelete ? "确认?" : "✕"}
          </button>
        </div>
      </div>
      <div className="text-xs text-text-muted truncate">{urlDisplay}</div>
      <div className="text-xs text-text-muted truncate">提取: {fieldSummary}</div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-text-muted">创建: {created}</span>
        <span className="text-[10px] text-text-muted">最后执行: {lastRun}</span>
      </div>
    </div>
  )
}
