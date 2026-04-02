import type { FieldMapping } from "../../lib/types"

interface Props {
  fields: FieldMapping[]
  onRemove: (index: number) => void
}

export function FieldList({ fields, onRemove }: Props) {
  if (fields.length === 0) {
    return <div className="text-[10px] text-text-muted text-center py-2">还没有选择字段</div>
  }

  return (
    <div className="space-y-1">
      {fields.map((field, i) => (
        <div
          key={i}
          className="flex justify-between items-center bg-primary/5 border border-primary/10 rounded px-2 py-1.5"
        >
          <div className="flex-1 min-w-0">
            <span className="text-[11px] text-primary">{field.name}</span>
            <span className="text-[9px] text-text-muted ml-1.5 truncate">{field.selector}</span>
          </div>
          <button
            onClick={() => onRemove(i)}
            className="text-[9px] text-red hover:text-red/80 ml-1 shrink-0"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
