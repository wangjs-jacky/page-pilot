import { useState, useEffect, useCallback } from "react"
import type { ClaudeCodeSkill, ClaudeCodeResult } from "../../lib/types"

interface Props {
  skills?: ClaudeCodeSkill[]
  onBack: () => void
  onResult: (result: ClaudeCodeResult) => void
}

/**
 * Claude Code 交互视图
 *
 * 所有 CC 请求通过 chrome.runtime.sendMessage 转发给 Background Service Worker，
 * 由 Background 统一操作 WebSocket 连接到 MCP Bridge。
 */
export function ClaudeCodeView({ skills: initialSkills, onBack, onResult }: Props) {
  const [mode, setMode] = useState<"skill" | "prompt">("prompt")
  const [skills, setSkills] = useState<ClaudeCodeSkill[]>(initialSkills || [])
  const [selectedSkill, setSelectedSkill] = useState("")
  const [promptText, setPromptText] = useState("")
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState("")
  const [mcpConnected, setMcpConnected] = useState(false)

  // 检查 MCP 连接状态（通过 Background）
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "MCP_STATUS" }, (res) => {
      if (chrome.runtime.lastError) return
      setMcpConnected(res?.connected ?? false)
    })

    const listener = (msg: any) => {
      if (msg.type === "MCP_STATUS" && msg.payload) {
        setMcpConnected(msg.payload.connected)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // 计时器
  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [loading])

  const handleListSkills = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      const res = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "CC_LIST_SKILLS" }, (r) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve(r)
          }
        })
      })
      if (res?.error) throw new Error(res.error)
      setSkills(Array.isArray(res?.skills) ? res.skills : [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInvokeSkill = useCallback(async () => {
    if (!selectedSkill) return
    const start = Date.now()
    try {
      setLoading(true)
      setError("")
      const res = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "CC_INVOKE_SKILL", payload: { skill: selectedSkill } },
          (r) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else {
              resolve(r)
            }
          }
        )
      })
      if (res?.error) throw new Error(res.error)
      onResult({
        id: `skill_${Date.now()}`,
        action: "invoke_skill",
        skill: selectedSkill,
        output: res?.output || "",
        executedAt: start,
        duration: Date.now() - start,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedSkill, onResult])

  const handleAskPrompt = useCallback(async () => {
    if (!promptText.trim()) return
    const start = Date.now()
    try {
      setLoading(true)
      setError("")
      const res = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "CC_ASK_PROMPT", payload: { prompt: promptText } },
          (r) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message))
            } else {
              resolve(r)
            }
          }
        )
      })
      if (res?.error) throw new Error(res.error)
      onResult({
        id: `prompt_${Date.now()}`,
        action: "ask_prompt",
        prompt: promptText,
        output: res?.output || "",
        executedAt: start,
        duration: Date.now() - start,
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [promptText, onResult])

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">Claude Code</span>
        </div>
        {!mcpConnected && (
          <span className="text-[10px] text-red">未连接</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 模式切换 */}
        <div className="flex gap-1 bg-white/[0.03] rounded p-0.5">
          <button
            onClick={() => setMode("prompt")}
            className={`flex-1 text-[11px] py-1.5 rounded transition-colors ${
              mode === "prompt" ? "bg-white/[0.08] text-text" : "text-text-muted"
            }`}
          >
            Prompt
          </button>
          <button
            onClick={() => setMode("skill")}
            className={`flex-1 text-[11px] py-1.5 rounded transition-colors ${
              mode === "skill" ? "bg-white/[0.08] text-text" : "text-text-muted"
            }`}
          >
            Skill
          </button>
        </div>

        {/* Prompt 模式 */}
        {mode === "prompt" && (
          <div className="space-y-2">
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="输入 prompt，Claude Code 将执行并返回结果..."
              className="w-full h-32 bg-white/[0.03] border border-white/[0.06] rounded p-2 text-xs text-text resize-none focus:outline-none focus:border-primary/30"
              disabled={loading}
            />
            <button
              onClick={handleAskPrompt}
              disabled={loading || !promptText.trim() || !mcpConnected}
              className="w-full text-xs text-primary bg-primary/10 py-2 rounded hover:bg-primary/20 disabled:opacity-30 transition-opacity"
            >
              {loading ? `执行中... ${elapsed}s` : "发送到 Claude Code"}
            </button>
          </div>
        )}

        {/* Skill 模式 */}
        {mode === "skill" && (
          <div className="space-y-2">
            <div className="flex gap-1 items-center">
              <select
                value={selectedSkill}
                onChange={(e) => setSelectedSkill(e.target.value)}
                className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-primary/30"
                disabled={loading}
              >
                <option value="">选择 Skill...</option>
                {skills.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleListSkills}
                disabled={loading}
                className="text-[10px] text-text-muted bg-white/[0.04] px-2 py-1.5 rounded hover:bg-white/[0.08] disabled:opacity-30"
              >
                刷新
              </button>
            </div>

            {selectedSkill && skills.find((s) => s.name === selectedSkill)?.description && (
              <div className="text-[10px] text-text-muted bg-white/[0.02] rounded p-2">
                {skills.find((s) => s.name === selectedSkill)?.description}
              </div>
            )}

            <button
              onClick={handleInvokeSkill}
              disabled={loading || !selectedSkill || !mcpConnected}
              className="w-full text-xs text-primary bg-primary/10 py-2 rounded hover:bg-primary/20 disabled:opacity-30 transition-opacity"
            >
              {loading ? `执行中... ${elapsed}s` : `执行 ${selectedSkill || "Skill"}`}
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="text-[10px] text-red bg-red/10 border border-red/20 rounded p-2">
            {error}
          </div>
        )}

        {/* Loading 态 */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-8 space-y-2">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <div className="text-[10px] text-text-muted">
              Claude Code 处理中... {elapsed}s
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
