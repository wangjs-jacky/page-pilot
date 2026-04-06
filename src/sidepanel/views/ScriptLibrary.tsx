import { useState, useEffect } from "react"
import type { ExtractionScript, ExtractionResult } from "../../lib/types"
import { deleteScript, updateLastExecuted } from "../../lib/storage/scripts"
import { ScriptCard } from "../components/ScriptCard"

interface Props {
  scripts: ExtractionScript[]
  matchedIds: string[]
  onNewScript: () => void
  onEditScript: (id: string) => void
  onExecuteScript: (result: ExtractionResult, editContext?: { scriptId?: string; tempScript: any }) => void
  onDeleteScript: () => void
  onOpenClaudeCode: () => void
}

export function ScriptLibrary({
  scripts,
  matchedIds,
  onNewScript,
  onEditScript,
  onExecuteScript,
  onDeleteScript,
  onOpenClaudeCode,
}: Props) {
  const [mcpConnected, setMcpConnected] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)

  useEffect(() => {
    // 检查初始状态
    chrome.runtime.sendMessage({ type: "MCP_STATUS" }, (res) => {
      if (res?.connected) setMcpConnected(true)
    })

    // 监听连接状态变化（保留 MCP 监听通道）
    const listener = (_message: any) => {}
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const toggleMCP = () => {
    if (mcpConnected) {
      chrome.runtime.sendMessage({ type: "MCP_DISCONNECT" })
      setMcpConnected(false)
    } else {
      chrome.runtime.sendMessage({ type: "MCP_CONNECT" })
    }
  }

  const handleExecute = async (script: ExtractionScript) => {
    const start = Date.now()
    setExecuting(script.id)

    // 统一通过 Background 在 MAIN world 执行（分页逻辑已内嵌在脚本中）
    try {
      const response = await chrome.runtime.sendMessage({
        type: "EXECUTE_IN_MAIN",
        payload: { code: script.code },
      })

      if (response?.error) {
        console.error("脚本执行失败:", response.error)
        return
      }

      const data = response?.result || []
      const duration = Date.now() - start

      await updateLastExecuted(script.id)

      onExecuteScript(
        {
          scriptId: script.id,
          data: Array.isArray(data) ? data : [data],
          executedAt: Date.now(),
          duration,
          count: Array.isArray(data) ? data.length : 1,
        },
        {
          scriptId: script.id,
          tempScript: {
            name: script.name,
            urlPatterns: script.urlPatterns,
            fields: script.fields,
            code: script.code,
            pagination: script.pagination,
            cardSelector: script.cardSelector,
            containerSelector: script.containerSelector,
          },
        }
      )
    } catch (error) {
      console.error("脚本执行失败:", error)
    } finally {
      setExecuting(null)
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
            onClick={toggleMCP}
            className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
              mcpConnected
                ? "text-primary bg-primary/10 hover:bg-primary/20"
                : "text-text-muted bg-white/[0.04] hover:bg-white/[0.08]"
            }`}
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                mcpConnected ? "bg-primary" : "bg-text-muted"
              }`}
            />
            {mcpConnected ? "MCP 已连接" : "连接 MCP"}
          </button>
          <button
            onClick={onNewScript}
            className="text-xs text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20"
          >
            + 新脚本
          </button>
          <button
            onClick={onOpenClaudeCode}
            disabled={!mcpConnected}
            className="text-xs text-blue bg-blue/10 px-2 py-1 rounded hover:bg-blue/20 disabled:opacity-30 disabled:cursor-not-allowed"
            title={!mcpConnected ? "请先连接 MCP" : "打开 Claude Code"}
          >
            CC
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
