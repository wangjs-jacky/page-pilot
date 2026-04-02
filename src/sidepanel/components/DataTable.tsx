interface Props {
  data: Record<string, any>[]
  maxRows?: number
}

export function DataTable({ data, maxRows = 20 }: Props) {
  if (data.length === 0) {
    return <div className="text-xs text-text-muted text-center py-4">无数据</div>
  }

  const headers = Object.keys(data[0])
  const displayData = data.slice(0, maxRows)

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded overflow-hidden">
      {/* 表头 */}
      <div className="flex bg-white/[0.03] border-b border-white/[0.06] px-2 py-1">
        {headers.map((h) => (
          <span key={h} className="flex-1 text-[9px] text-text-muted truncate">
            {h}
          </span>
        ))}
      </div>
      {/* 数据行 */}
      {displayData.map((row, i) => (
        <div
          key={i}
          className="flex px-2 py-1 border-b border-white/[0.03] last:border-0"
        >
          {headers.map((h) => (
            <span key={h} className="flex-1 text-[9px] text-text truncate">
              {row[h] ?? ""}
            </span>
          ))}
        </div>
      ))}
      {data.length > maxRows && (
        <div className="text-center py-1">
          <span className="text-[9px] text-text-muted">... 共 {data.length} 条</span>
        </div>
      )}
    </div>
  )
}
