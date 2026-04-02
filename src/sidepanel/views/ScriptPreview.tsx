import { useState } from "react"
import type { FieldMapping } from "../../lib/types"
import { FieldList } from "../components/FieldList"

interface Props {
  tempScript: {
    name: string
    urlPatterns: string[]
    fields: FieldMapping[]
    code: string
  }
  onSave: () => void
  onCancel: () => void
}

export function ScriptPreview({ tempScript, onSave, onCancel }: Props) {
  const [name, setName] = useState(tempScript.name || "新脚本")
  const [urlPatterns, setUrlPatterns] = useState(tempScript.urlPatterns.join("\n"))
  const [code, setCode] = useState(tempScript.code)

  const handleSave = async () => {
    const { saveScript } = await import("../../lib/storage/scripts")
    await saveScript({
      id: crypto.randomUUID(),
      name: name.trim() || "未命名脚本",
      urlPatterns: urlPatterns.split("\n").filter(Boolean),
      fields: tempScript.fields,
      code,
      createdAt: Date.now(),
    })
    onSave()
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code)
  }

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部 */}
      <div className="flex justify-between items-center p-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-[11px] text-text-muted hover:text-text">
            ← 返回
          </button>
          <span className="text-sm font-bold">脚本预览</span>
        </div>
        <span className="text-[10px] text-primary">保存脚本</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 脚本名称 */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">脚本名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-bg-elevated border border-white/10 rounded px-2 py-1.5 text-xs text-text outline-none focus:border-primary"
          />
        </div>

        {/* URL Pattern */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">
            URL 匹配规则（每行一个）
          </label>
          <textarea
            value={urlPatterns}
            onChange={(e) => setUrlPatterns(e.target.value)}
            placeholder="example.com/*"
            rows={2}
            className="w-full bg-bg-elevated border border-white/10 rounded px-2 py-1.5 text-xs text-text placeholder-text-muted outline-none focus:border-primary resize-none"
          />
        </div>

        {/* 字段映射 */}
        <div>
          <label className="block text-[10px] text-text-muted mb-1">
            字段映射 ({tempScript.fields.length} 个)
          </label>
          <FieldList fields={tempScript.fields} onRemove={() => {}} />
        </div>

        {/* 代码预览 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] text-text-muted">生成代码</label>
            <button
              onClick={handleCopyCode}
              className="text-[9px] text-text-muted hover:text-text"
            >
              复制
            </button>
          </div>
          <div className="bg-bg-elevated border border-primary/20 rounded-lg overflow-hidden">
            <div className="p-0.5 bg-primary/5 border-b border-primary/10 px-2">
              <span className="text-[9px] text-primary">提取脚本</span>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={10}
              className="w-full bg-transparent p-2 text-[10px] text-text-muted font-mono leading-relaxed outline-none resize-y"
            />
          </div>
        </div>
      </div>

      {/* 底部 */}
      <div className="p-3 border-t border-white/[0.06] flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 text-center text-[11px] text-text-muted py-2 border border-white/[0.08] rounded hover:bg-white/[0.03]"
        >
          返回编辑
        </button>
        <button
          onClick={handleSave}
          className="flex-1 text-center text-[11px] text-bg bg-primary py-2 rounded font-bold hover:bg-primary/90"
        >
          保存脚本
        </button>
      </div>
    </div>
  )
}
