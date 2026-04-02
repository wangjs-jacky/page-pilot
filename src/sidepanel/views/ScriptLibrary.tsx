import type { ExtractionScript, ExtractionResult } from "../../lib/types"
import { deleteScript, updateLastExecuted } from "../../lib/storage/scripts"
import { ScriptCard } from "../components/ScriptCard"

interface Props {
  scripts: ExtractionScript[]
  matchedIds: string[]
  onNewScript: () => void
  onEditScript: (id: string) => void
  onExecuteScript: (result: ExtractionResult) => void
  onDeleteScript: () => void
}

export function ScriptLibrary({
  scripts,
  matchedIds,
  onNewScript,
  onEditScript,
  onExecuteScript,
  onDeleteScript,
}: Props) {
  const handleExecute = async (script: ExtractionScript) => {
    const start = Date.now()
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) return

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: new Function(script.code) as any,
      })

      const data = results?.[0]?.result || []
      const duration = Date.now() - start

      await updateLastExecuted(script.id)

      onExecuteScript({
        scriptId: script.id,
        data: Array.isArray(data) ? data : [data],
        executedAt: Date.now(),
        duration,
        count: Array.isArray(data) ? data.length : 1,
      })
    } catch (error) {
      console.error("脚本执行失败:", error)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteScript(id)
    onDeleteScript()
  }

  const matchedCount = scripts.filter((s) => matchedIds.includes(s.id)).length

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <span className="text-sm font-bold">PagePilot</span>
        <div className="flex gap-2 items-center">
          <button
            onClick={onNewScript}
            className="text-xs text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20"
          >
            + 新脚本
          </button>
          <a
            href={chrome.runtime.getURL("options.html")}
            target="_blank"
            className="text-xs text-text-muted hover:text-text"
          >
            ⚙
          </a>
        </div>
      </div>

      {/* URL 匹配提示 */}
      {matchedCount > 0 && (
        <div className="mx-3 mt-3 bg-primary/10 border border-primary/20 rounded-lg p-2 flex justify-between items-center">
          <div className="text-[10px] text-primary">
            当前页面匹配到 {matchedCount} 个脚本
          </div>
        </div>
      )}

      {/* 脚本列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {scripts.length === 0 ? (
          <div className="text-center text-text-muted text-xs mt-12">
            还没有脚本，点击"+ 新脚本"开始创建
          </div>
        ) : (
          scripts.map((script) => (
            <ScriptCard
              key={script.id}
              script={script}
              isMatched={matchedIds.includes(script.id)}
              onExecute={handleExecute}
              onEdit={onEditScript}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}
