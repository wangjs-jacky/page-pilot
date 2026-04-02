import { toJSON, toCSV, downloadFile, copyToClipboard } from "../../lib/export"

interface Props {
  data: Record<string, any>[]
  scriptName: string
}

export function ExportBar({ data, scriptName }: Props) {
  const handleCopyJSON = async () => {
    await copyToClipboard(toJSON(data))
  }

  const handleExportJSON = () => {
    const content = toJSON(data)
    downloadFile(content, `${scriptName}.json`, "application/json")
  }

  const handleExportCSV = () => {
    const content = toCSV(data)
    downloadFile(content, `${scriptName}.csv`, "text/csv")
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={handleCopyJSON}
        className="flex-1 text-center text-[10px] text-primary bg-primary/10 py-1.5 rounded hover:bg-primary/20"
      >
        复制 JSON
      </button>
      <button
        onClick={handleExportCSV}
        className="flex-1 text-center text-[10px] text-blue bg-blue/10 py-1.5 rounded hover:bg-blue/20"
      >
        导出 CSV
      </button>
      <button
        onClick={handleExportJSON}
        className="flex-1 text-center text-[10px] text-amber bg-amber/10 py-1.5 rounded hover:bg-amber/20"
      >
        导出 JSON
      </button>
    </div>
  )
}
