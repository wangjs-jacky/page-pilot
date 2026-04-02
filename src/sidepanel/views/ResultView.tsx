import type { ExtractionResult } from "../../lib/types"
import { DataTable } from "../components/DataTable"
import { ExportBar } from "../components/ExportBar"

interface Props {
  result: ExtractionResult
  onBack: () => void
}

export function ResultView({ result, onBack }: Props) {
  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">执行结果</span>
        </div>
        <span className="text-[10px] text-primary">✓ 提取成功</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 统计 */}
        <div className="flex gap-2">
          <div className="flex-1 bg-primary/5 rounded p-2 text-center">
            <div className="text-sm font-bold text-primary">{result.count}</div>
            <div className="text-[9px] text-text-muted">条数据</div>
          </div>
          <div className="flex-1 bg-blue/5 rounded p-2 text-center">
            <div className="text-sm font-bold text-blue">
              {result.data.length > 0 ? Object.keys(result.data[0]).length : 0}
            </div>
            <div className="text-[9px] text-text-muted">个字段</div>
          </div>
          <div className="flex-1 bg-amber/5 rounded p-2 text-center">
            <div className="text-sm font-bold text-amber">{result.duration}</div>
            <div className="text-[9px] text-text-muted">ms</div>
          </div>
        </div>

        {/* 数据表格 */}
        <div>
          <div className="text-[10px] text-text-muted mb-1">提取结果预览</div>
          <DataTable data={result.data} />
        </div>
      </div>

      {/* 导出栏 */}
      <div className="p-3 border-t border-white/[0.06]">
        <ExportBar data={result.data} scriptName="提取结果" />
      </div>
    </div>
  )
}
