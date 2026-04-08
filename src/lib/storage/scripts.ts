import type { ExtractionScript } from "../types"

const SCRIPTS_KEY = "pagepilot_scripts"

export async function getAllScripts(): Promise<ExtractionScript[]> {
  const result = await chrome.storage.local.get(SCRIPTS_KEY)
  return result[SCRIPTS_KEY] || []
}

export async function getScript(id: string): Promise<ExtractionScript | undefined> {
  const scripts = await getAllScripts()
  return scripts.find((s) => s.id === id)
}

export async function saveScript(script: ExtractionScript): Promise<void> {
  const scripts = await getAllScripts()
  const index = scripts.findIndex((s) => s.id === script.id)
  if (index >= 0) {
    scripts[index] = script
  } else {
    scripts.push(script)
  }
  await chrome.storage.local.set({ [SCRIPTS_KEY]: scripts })
}

export async function duplicateScript(id: string): Promise<ExtractionScript | null> {
  const script = await getScript(id)
  if (!script) return null
  const dup: ExtractionScript = {
    ...script,
    id: crypto.randomUUID(),
    name: `${script.name} (副本)`,
    createdAt: Date.now(),
    lastExecutedAt: undefined,
  }
  await saveScript(dup)
  return dup
}

export async function deleteScript(id: string): Promise<void> {
  const scripts = await getAllScripts()
  const filtered = scripts.filter((s) => s.id !== id)
  await chrome.storage.local.set({ [SCRIPTS_KEY]: filtered })
}

export async function updateLastExecuted(id: string): Promise<void> {
  const script = await getScript(id)
  if (script) {
    script.lastExecutedAt = Date.now()
    await saveScript(script)
  }
}

// URL glob 匹配
function matchURL(pattern: string, url: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
  return new RegExp(`^${regex}$`).test(url)
}

export async function findMatchingScripts(url: string): Promise<ExtractionScript[]> {
  const scripts = await getAllScripts()
  return scripts.filter((s) => s.urlPatterns.some((p) => matchURL(p, url)))
}
