import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getAllScripts,
  getScript,
  saveScript,
  deleteScript,
  updateLastExecuted,
  findMatchingScripts,
} from "./scripts"
import type { ExtractionScript } from "../types"

// Mock chrome.storage API
const mockStorage: Record<string, any> = {}

const mockChromeStorage = {
  local: {
    get: vi.fn((key: string) => {
      return Promise.resolve(mockStorage[key] ? { [key]: mockStorage[key] } : {})
    }),
    set: vi.fn((data: Record<string, any>) => {
      Object.assign(mockStorage, data)
      return Promise.resolve()
    }),
  },
}

;(global as any).chrome = {
  storage: mockChromeStorage,
}

describe("Scripts Storage", () => {
  const mockScript: ExtractionScript = {
    id: "test-script-1",
    name: "Test Script",
    urlPatterns: ["https://example.com/*"],
    fields: [
      { name: "title", selector: "h1", attribute: "textContent" },
      { name: "price", selector: ".price", attribute: "textContent" },
    ],
    code: "const data = []; return data;",
    createdAt: Date.now(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  describe("getAllScripts", () => {
    it("应该返回空数组（当存储为空时）", async () => {
      const scripts = await getAllScripts()
      expect(scripts).toEqual([])
    })

    it("应该返回所有脚本", async () => {
      mockStorage["pagepilot_scripts"] = [mockScript]

      const scripts = await getAllScripts()

      expect(scripts).toHaveLength(1)
      expect(scripts[0]).toEqual(mockScript)
    })
  })

  describe("getScript", () => {
    it("应该根据 ID 获取脚本", async () => {
      mockStorage["pagepilot_scripts"] = [mockScript]

      const script = await getScript("test-script-1")

      expect(script).toEqual(mockScript)
    })

    it("应该为不存在的 ID 返回 undefined", async () => {
      const script = await getScript("non-existent")
      expect(script).toBeUndefined()
    })
  })

  describe("saveScript", () => {
    it("应该添加新脚本", async () => {
      await saveScript(mockScript)

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts).toHaveLength(1)
      expect(scripts[0]).toEqual(mockScript)
    })

    it("应该更新现有脚本", async () => {
      mockStorage["pagepilot_scripts"] = [mockScript]

      const updatedScript: ExtractionScript = {
        ...mockScript,
        name: "Updated Script",
      }

      await saveScript(updatedScript)

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts).toHaveLength(1)
      expect(scripts[0].name).toBe("Updated Script")
    })

    it("应该保持脚本顺序", async () => {
      const script1 = { ...mockScript, id: "script-1" }
      const script2 = { ...mockScript, id: "script-2" }
      const script3 = { ...mockScript, id: "script-3" }

      await saveScript(script1)
      await saveScript(script2)
      await saveScript(script3)

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts).toHaveLength(3)
      expect(scripts.map((s: ExtractionScript) => s.id)).toEqual([
        "script-1",
        "script-2",
        "script-3",
      ])
    })
  })

  describe("deleteScript", () => {
    it("应该删除指定脚本", async () => {
      mockStorage["pagepilot_scripts"] = [mockScript]

      await deleteScript("test-script-1")

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts).toHaveLength(0)
    })

    it("应该保留其他脚本", async () => {
      const script1 = { ...mockScript, id: "script-1" }
      const script2 = { ...mockScript, id: "script-2" }
      mockStorage["pagepilot_scripts"] = [script1, script2]

      await deleteScript("script-1")

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts).toHaveLength(1)
      expect(scripts[0].id).toBe("script-2")
    })
  })

  describe("updateLastExecuted", () => {
    it("应该更新脚本的最后执行时间", async () => {
      mockStorage["pagepilot_scripts"] = [mockScript]

      const before = Date.now()
      await updateLastExecuted("test-script-1")
      const after = Date.now()

      const scripts = mockStorage["pagepilot_scripts"]
      expect(scripts[0].lastExecutedAt).toBeDefined()
      expect(scripts[0].lastExecutedAt).toBeGreaterThanOrEqual(before)
      expect(scripts[0].lastExecutedAt).toBeLessThanOrEqual(after)
    })

    it("应该忽略不存在的脚本", async () => {
      await updateLastExecuted("non-existent")

      expect(mockStorage["pagepilot_scripts"]).toBeUndefined()
    })
  })

  describe("findMatchingScripts", () => {
    const scripts = [
      {
        ...mockScript,
        id: "script-1",
        urlPatterns: ["https://example.com/*"],
      },
      {
        ...mockScript,
        id: "script-2",
        urlPatterns: ["https://shop.com/products/*"],
      },
      {
        ...mockScript,
        id: "script-3",
        urlPatterns: ["https://example.com/products/*", "https://example.com/items/*"],
      },
    ]

    beforeEach(() => {
      mockStorage["pagepilot_scripts"] = scripts
    })

    it("应该匹配单个 URL 模式", async () => {
      const matching = await findMatchingScripts("https://example.com/page")

      expect(matching).toHaveLength(1)
      expect(matching[0].id).toBe("script-1")
    })

    it("应该匹配多个模式", async () => {
      const matching = await findMatchingScripts("https://example.com/products/123")

      expect(matching).toHaveLength(2)
      expect(matching.map((s) => s.id).sort()).toEqual(["script-1", "script-3"])
    })

    it("应该支持通配符", async () => {
      const matching = await findMatchingScripts("https://shop.com/products/item-1")

      expect(matching).toHaveLength(1)
      expect(matching[0].id).toBe("script-2")
    })

    it("应该返回空数组（无匹配时）", async () => {
      const matching = await findMatchingScripts("https://other.com/page")

      expect(matching).toHaveLength(0)
    })
  })
})
