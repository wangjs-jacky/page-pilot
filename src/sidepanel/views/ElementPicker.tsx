import { useState, useEffect } from "react"
import type { FieldMapping } from "../../lib/types"
import { getAIConfig } from "../../lib/storage/settings"
import { generateExtractionScript } from "../../lib/ai/client"
import { buildUserPrompt, extractCodeFromResponse } from "../../lib/ai/prompt-builder"
import { FieldList } from "../components/FieldList"

interface Props {
  scriptId?: string
  onGenerate: (
    fields: FieldMapping[],
    code: string,
    name: string,
    urlPatterns: string[]
  ) => void
  onCancel: () => void
}

export function ElementPicker({ scriptId, onGenerate, onCancel }: Props) {
  const [fields, setFields] = useState<FieldMapping[]>([])
  const [currentSelector, setCurrentSelector] = useState("")
  const [currentText, setCurrentText] = useState("")
  const [fieldName, setFieldName] = useState("")
  const [attribute, setAttribute] = useState("textContent")
  const [generating, setGenerating] = useState(false)
  const [pageUrl, setPageUrl] = useState("")

  // 获取当前页面 URL
  useEffect(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.url) setPageUrl(tab.url)
    })
  }, [])

  // 开启/关闭元素选择模式
  useEffect(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "START_PICKER" })
      }
    })

    return () => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "STOP_PICKER" })
        }
      })
    }
  }, [])

  // 监听元素选中事件（通过 CustomEvent，由 SidePanel index 转发）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setCurrentSelector(detail.selector)
      setCurrentText(detail.text)
      setFieldName("")
    }
    window.addEventListener("pagepilot-element-selected", handler)
    return () => window.removeEventListener("pagepilot-element-selected", handler)
  }, [])

  const addField = () => {
    if (!fieldName.trim() || !currentSelector) return
    setFields([...fields, { name: fieldName.trim(), selector: currentSelector, attribute }])
    setFieldName("")
    setCurrentSelector("")
    setCurrentText("")
  }

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (fields.length === 0) return
    setGenerating(true)
    try {
      const config = await getAIConfig()
      const domContext = fields.map((f) => `${f.name}: ${f.selector}`).join("\n")
      const userPrompt = buildUserPrompt(fields, domContext)
      const systemPrompt = `你是一个网页数据提取脚本生成器。`

      const response = await generateExtractionScript(config, systemPrompt, userPrompt)
      const code = extractCodeFromResponse(response)

      const urlObj = new URL(pageUrl)
      const defaultPattern = `${urlObj.hostname}/*`

      onGenerate(fields, code, "", [defaultPattern])
    } catch (error: any) {
      console.error("生成失败:", error)
      alert(`生成失败: ${error.message}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">新建脚本</span>
        </div>
        <span className="text-[10px] text-amber">选择元素</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 提示 */}
        <div className="bg-blue/10 border border-blue/20 rounded-lg p-2">
          <div className="text-[10px] text-blue">点击页面元素来选择要提取的字段</div>
          <div className="text-[9px] text-text-muted mt-0.5">
            鼠标悬停时元素会高亮，点击即可选中
          </div>
        </div>

        {/* 已选字段 */}
        <div>
          <div className="text-[10px] text-text-muted mb-1.5">
            已选择 {fields.length} 个字段
          </div>
          <FieldList fields={fields} onRemove={removeField} />
        </div>

        {/* 当前选中元素 */}
        {currentSelector && (
          <div>
            <div className="text-[10px] text-text-muted mb-1">
              当前选中: <span className="text-blue">{currentSelector}</span>
              {currentText && (
                <span className="text-text-muted ml-1">「{currentText.slice(0, 20)}」</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addField()}
                placeholder="字段名称"
                className="flex-1 bg-bg-elevated border border-blue/30 rounded px-2 py-1 text-[11px] text-text placeholder-text-muted outline-none focus:border-primary"
                autoFocus
              />
              <select
                value={attribute}
                onChange={(e) => setAttribute(e.target.value)}
                className="bg-bg-elevated border border-white/10 rounded px-1.5 py-1 text-[10px] text-text outline-none"
              >
                <option value="textContent">文本</option>
                <option value="href">链接</option>
                <option value="src">图片</option>
                <option value="innerHTML">HTML</option>
              </select>
              <button
                onClick={addField}
                className="text-[10px] text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20"
              >
                确认
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部 */}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-center text-[11px] text-text-muted py-2 border border-white/[0.08] rounded hover:bg-white/[0.03]"
        >
          取消
        </button>
        <button
          onClick={handleGenerate}
          disabled={fields.length === 0 || generating}
          className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? "生成中..." : "生成脚本 →"}
        </button>
      </div>
    </div>
  )
}
