import type { ExtractionScript } from "../../lib/types"

interface Props {
  script: ExtractionScript
  isMatched: boolean
  onExecute: (script: ExtractionScript) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function ScriptCard({ script, isMatched, onExecute, onEdit, onDelete }: Props) {
  const fieldSummary = script.fields.map((f) => f.name).join(" · ")
  const lastRun = script.lastExecutedAt
    ? new Date(script.lastExecutedAt).toLocaleDateString("zh-CN")
    : "未执行"

  return (
    <div
      className={`rounded-lg p-3 border transition-colors ${
        isMatched
          ? "bg-primary/5 border-primary/20"
          : "bg-white/[0.02] border-white/[0.06]"
      }`}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-bold truncate flex-1">{script.name}</span>
        <div className="flex gap-2 ml-2 shrink-0">
          <button
            onClick={() => onExecute(script)}
            className="text-xs text-primary hover:text-primary/80"
          >
            ▶ 执行
          </button>
          <button
            onClick={() => onEdit(script.id)}
            className="text-xs text-text-muted hover:text-text"
          >
            ✎
          </button>
          <button
            onClick={() => onDelete(script.id)}
            className="text-xs text-text-muted hover:text-red"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="text-xs text-text-muted truncate">提取: {fieldSummary}</div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-text-muted">{script.urlPatterns.join(", ")}</span>
        <span className="text-[10px] text-text-muted">最后执行: {lastRun}</span>
      </div>
    </div>
  )
}
