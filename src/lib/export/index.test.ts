import { describe, it, expect } from "vitest"
import { toJSON, toCSV } from "./index"

describe("Export Functions", () => {
  describe("toJSON", () => {
    it("序列化对象数组（带缩进）", () => {
      const data = [{ name: "测试", count: 10 }]
      const json = toJSON(data)
      expect(json).toBe(JSON.stringify(data, null, 2))
      expect(JSON.parse(json)).toEqual(data)
    })

    it("处理空数组", () => {
      expect(toJSON([])).toBe("[]")
    })

    it("处理嵌套对象", () => {
      const data = [{ user: { name: "Alice", address: { city: "上海" } } }]
      const parsed = JSON.parse(toJSON(data))
      expect(parsed[0].user.address.city).toBe("上海")
    })

    it("处理 null 和 undefined 值", () => {
      const data = [{ name: "test", value: null, extra: undefined }]
      const parsed = JSON.parse(toJSON(data))
      expect(parsed[0].value).toBeNull()
      expect(parsed[0]).not.toHaveProperty("extra")
    })
  })

  describe("toCSV", () => {
    it("生成带表头的 CSV", () => {
      const data = [
        { name: "Alice", age: "30" },
        { name: "Bob", age: "25" },
      ]
      const csv = toCSV(data)
      const lines = csv.split("\n")
      expect(lines[0]).toBe("name,age")
      expect(lines[1]).toBe("Alice,30")
      expect(lines[2]).toBe("Bob,25")
    })

    it("转义包含逗号的值", () => {
      const data = [{ desc: "hello, world" }]
      expect(toCSV(data)).toContain('"hello, world"')
    })

    it("转义包含双引号的值", () => {
      const data = [{ desc: 'say "hi"' }]
      expect(toCSV(data)).toContain('"say ""hi"""')
    })

    it("转义包含换行的值", () => {
      const data = [{ desc: "line1\nline2" }]
      const csv = toCSV(data)
      // CSV 中的换行在引号内
      expect(csv).toContain('"line1\nline2"')
    })

    it("处理 null/undefined 值（显示为空）", () => {
      const data = [{ name: "test", value: null as any }]
      const csv = toCSV(data)
      const lines = csv.split("\n")
      expect(lines[1]).toBe("test,")
    })

    it("空数组返回空字符串", () => {
      expect(toCSV([])).toBe("")
    })

    it("数字值转为字符串", () => {
      const data = [{ count: 100 }]
      expect(toCSV(data)).toContain("100")
    })
  })
})
