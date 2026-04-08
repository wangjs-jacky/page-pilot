import { useState, useEffect, useCallback } from "react"
import type { ViewState, ExtractionScript, ExtractionResult, FieldMapping, PaginationConfig, ClaudeCodeResult, ClaudeCodeSkill, DryRunResult } from "../lib/types"
import { getAllScripts, getScript } from "../lib/storage/scripts"
import { ScriptLibrary } from "./views/ScriptLibrary"
import { ElementPicker } from "./views/ElementPicker"
import { ScriptPreview } from "./views/ScriptPreview"
import { ResultView } from "./views/ResultView"
import { ClaudeCodeView } from "./views/ClaudeCodeView"
import { ClaudeCodeResultView } from "./views/ClaudeCodeResultView"
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

  // 从 Picker 生成后进入 Preview（新建模式）
  const goPreview = useCallback(
    (
      fields: FieldMapping[],
      code: string,
      name: string,
      urlPatterns: string[],
      pagination?: PaginationConfig,
      cardSelector?: string,
      containerSelector?: string,
      dryRunResult?: DryRunResult
    ) => {
      setViewState({
        view: "preview",
        tempScript: {
          name,
          urlPatterns,
          fields,
          code,
          pagination,
          cardSelector,
          containerSelector,
        },
        dryRunResult,
      })
    },
    []
  )

  // 从 Library 编辑已有脚本 → 加载后跳到 Preview
  const goEditPreview = useCallback(async (scriptId: string) => {
    const script = await getScript(scriptId)
    if (!script) return
    setViewState({
      view: "preview",
      scriptId,
      tempScript: {
        name: script.name,
        urlPatterns: script.urlPatterns,
        fields: script.fields,
        code: script.code,
        pagination: script.pagination,
        cardSelector: script.cardSelector,
        containerSelector: script.containerSelector,
      },
    })
  }, [])

  // 执行后跳到 Result，同时记录 editContext 以便回退到 Preview
  const goResult = useCallback((result: ExtractionResult, editContext?: { scriptId?: string; tempScript: Omit<ExtractionScript, "id" | "createdAt"> }) => {
    setViewState({ view: "result", result, editContext })
  }, [])

  const goClaudeCode = useCallback((skills?: ClaudeCodeSkill[]) => {
    setViewState({ view: "claude-code", mode: "idle", skills })
  }, [])

  const goClaudeCodeResult = useCallback((result: ClaudeCodeResult) => {
    setViewState({ view: "claude-code-result", result })
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text font-sans">
      {viewState.view === "library" && (
        <ScriptLibrary
          scripts={scripts}
          matchedIds={matchedIds}
          onNewScript={goPicker}
          onEditScript={goEditPreview}
          onExecuteScript={goResult}
          onDeleteScript={loadScripts}
          onRefresh={loadScripts}
          onOpenClaudeCode={() => goClaudeCode()}
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
          scriptId={viewState.scriptId}
          tempScript={viewState.tempScript}
          autoOpenOptimize={viewState.autoOpenOptimize}
          executionResult={viewState.executionResult}
          dryRunResult={viewState.dryRunResult}
          onSave={goLibrary}
          onExecute={(result) => goResult(result, { scriptId: viewState.scriptId, tempScript: viewState.tempScript })}
          onCancel={goLibrary}
        />
      )}
      {viewState.view === "result" && (
        <ResultView
          result={viewState.result}
          onBack={goLibrary}
          onEdit={
            viewState.editContext
              ? () =>
                  setViewState({
                    view: "preview",
                    scriptId: viewState.editContext?.scriptId,
                    tempScript: viewState.editContext!.tempScript,
                  })
              : undefined
          }
          onOptimize={
            viewState.editContext
              ? () =>
                  setViewState({
                    view: "preview",
                    scriptId: viewState.editContext?.scriptId,
                    tempScript: viewState.editContext!.tempScript,
                    autoOpenOptimize: true,
                    executionResult: viewState.result?.data,
                  })
              : undefined
          }
        />
      )}
      {viewState.view === "claude-code" && (
        <ClaudeCodeView
          skills={viewState.skills}
          onBack={goLibrary}
          onResult={goClaudeCodeResult}
        />
      )}
      {viewState.view === "claude-code-result" && (
        <ClaudeCodeResultView
          result={viewState.result}
          onNewRequest={() => goClaudeCode()}
          onBack={goLibrary}
        />
      )}
    </div>
  )
}
