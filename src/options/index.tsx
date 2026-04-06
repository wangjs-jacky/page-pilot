import { useState, useEffect } from "react"
import { PROVIDERS } from "../lib/ai/providers"
import { testConnection } from "../lib/ai/client"
import { getSettings, saveSettings } from "../lib/storage/settings"
import type { AIProviderConfig } from "../lib/types"
import "../style.css"

// Provider ID 类型
type ProviderId = AIProviderConfig["providerId"]

export default function Options() {
  const [config, setConfig] = useState<AIProviderConfig>({
    providerId: "deepseek",
    apiKey: "",
    model: "deepseek-chat",
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getSettings().then((s) => setConfig(s.ai))
  }, [])

  const handleProviderChange = (providerId: string) => {
    const provider = PROVIDERS[providerId]
    if (!provider) return

    setConfig({
      providerId: providerId as ProviderId,
      apiKey: "",
      model: provider.defaultModel,
    })
    setTestResult(null)
    setSaved(false)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection(config)
    setTesting(false)
    if (result.success) {
      setTestResult({
        success: true,
        message: result.note
          ? `连接成功（${result.latency}ms）— ${result.note}`
          : `连接成功（${result.latency}ms）`,
      })
    } else {
      setTestResult({ success: false, message: result.error || "连接失败" })
    }
  }

  const handleSave = async () => {
    await saveSettings({ ai: config })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const provider = PROVIDERS[config.providerId]

  if (!provider) {
    return (
      <div className="min-h-screen bg-bg text-text font-sans p-8">
        <div className="max-w-lg mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">配置错误</h1>
          <p className="text-text-muted">未找到服务商配置</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text font-sans p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-6">PagePilot 设置</h1>

        {/* 服务商选择 */}
        <div className="mb-4">
          <label className="block text-sm text-text-muted mb-2">AI 服务商</label>
          <select
            value={config.providerId}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
          >
            {Object.entries(PROVIDERS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div className="mb-4">
          <label className="block text-sm text-text-muted mb-2">API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => {
              setConfig({ ...config, apiKey: e.target.value })
              setSaved(false)
            }}
            placeholder={`输入 ${provider.name} API Key`}
            className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-text placeholder-text-muted focus:border-primary outline-none"
          />
        </div>

        {/* 模型选择 */}
        <div className="mb-6">
          <label className="block text-sm text-text-muted mb-2">模型</label>
          <select
            value={config.model}
            onChange={(e) => {
              setConfig({ ...config, model: e.target.value })
              setSaved(false)
            }}
            className="w-full bg-bg-elevated border border-white/10 rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
          >
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleTest}
            disabled={testing || !config.apiKey}
            className="px-4 py-2 bg-blue/20 text-blue border border-blue/30 rounded-lg hover:bg-blue/30 disabled:opacity-50"
          >
            {testing ? "测试中..." : "测试连接"}
          </button>
          <button
            onClick={handleSave}
            disabled={!config.apiKey}
            className="px-4 py-2 bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 disabled:opacity-50"
          >
            保存设置
          </button>
        </div>

        {/* 测试结果 */}
        {testResult && (
          <div
            className={`mt-4 p-3 rounded-lg border ${
              testResult.success
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-red/10 border-red/20 text-red"
            }`}
          >
            {testResult.success ? "✓ " : "✗ "}
            {testResult.message}
          </div>
        )}

        {/* 保存提示 */}
        {saved && (
          <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary">
            ✓ 设置已保存
          </div>
        )}
      </div>
    </div>
  )
}
