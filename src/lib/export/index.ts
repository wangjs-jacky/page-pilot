/**
 * 将提取结果导出为 JSON 字符串
 */
export function toJSON(data: Record<string, any>[]): string {
  return JSON.stringify(data, null, 2)
}

/**
 * 将提取结果导出为 CSV 字符串
 */
export function toCSV(data: Record<string, any>[]): string {
  if (data.length === 0) return ""
  const headers = Object.keys(data[0])
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h] ?? ""
        const str = String(val)
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      .join(",")
  )
  return [headers.join(","), ...rows].join("\n")
}

/**
 * 触发浏览器下载文件
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
