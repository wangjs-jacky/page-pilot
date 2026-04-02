import { useState, useEffect, useCallback } from "react"
import type { ViewState, ExtractionScript, ExtractionResult, FieldMapping } from "../lib/types"
import { getAllScripts } from "../lib/storage/scripts"
import { ScriptLibrary } from "./views/ScriptLibrary"
import { ElementPicker } from "./views/ElementPicker"
import { ScriptPreview } from "./views/ScriptPreview"
import { ResultView } from "./views/ResultView"
import "../style.css"

export default function SidePanel() {
  const [viewState, setViewState] = useState<ViewState>({ view: "library" })
  const [scripts, setScripts] = useState<ExtractionScript[]>([])
  const [matchedIds, setMatchedIds] = useState<string[]>([])

  // 加载脚本列表
  const loadScripts = useCallback(async () => {
    const all = await getAllScripts()
    setScripts(all)
  }, [])

  useEffect(() => {
    loadScripts()
  }, [loadScripts])

  // 监听来自 Content Script 和 Service Worker 的消息
  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === "URL_MATCHED") {
        setMatchedIds(message.payload.scriptIds)
      }
      if (message.type === "ELEMENT_SELECTED") {
        // 转发为 CustomEvent 给 ElementPicker
        window.dispatchEvent(
          new CustomEvent("pagepilot-element-selected", { detail: message.payload })
        )
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // 视图切换
  const goLibrary = useCallback(() => {
    loadScripts()
    setViewState({ view: "library" })
  }, [loadScripts])

  const goPicker = useCallback(() => {
    setViewState({ view: "picker" })
  }, [])

  const goPreview = useCallback(
    (fields: FieldMapping[], code: string, name: string, urlPatterns: string[]) => {
      setViewState({
        view: "preview",
        tempScript: { name, urlPatterns, fields, code },
      })
    },
    []
  )

  const goResult = useCallback((result: ExtractionResult) => {
    setViewState({ view: "result", result })
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      {viewState.view === "library" && (
        <ScriptLibrary
          scripts={scripts}
          matchedIds={matchedIds}
          onNewScript={goPicker}
          onEditScript={(id) => {
            setViewState({ view: "picker", scriptId: id })
          }}
          onExecuteScript={goResult}
          onDeleteScript={loadScripts}
        />
      )}
      {viewState.view === "picker" && (
        <ElementPicker
          scriptId={viewState.scriptId}
          onGenerate={goPreview}
          onCancel={goLibrary}
        />
      )}
      {viewState.view === "preview" && (
        <ScriptPreview
          tempScript={viewState.tempScript}
          onSave={goLibrary}
          onCancel={goPicker}
        />
      )}
      {viewState.view === "result" && (
        <ResultView result={viewState.result} onBack={goLibrary} />
      )}
    </div>
  )
}
