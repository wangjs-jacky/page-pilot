import fs from "fs"
import path from "path"

const FIXTURES_DIR = path.resolve(__dirname)

/**
 * 读取 fixture 文件内容
 */
export function loadFixture(filename: string): string {
  const filePath = path.join(FIXTURES_DIR, filename)
  return fs.readFileSync(filePath, "utf-8")
}

/**
 * 将 fixture HTML 注入当前 jsdom document
 * 只提取 <body> 内容，适合选择性测试
 */
export function injectBodyHTML(filename: string): void {
  const html = loadFixture(filename)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  document.body.innerHTML = bodyMatch ? bodyMatch[1] : html
}

/**
 * 将完整 fixture HTML 加载到 document
 * 保留完整的 DOM 结构（head + body）
 */
export function loadFullDocument(filename: string): void {
  const html = loadFixture(filename)
  document.documentElement.innerHTML = html
}

/**
 * 确保 CSS.escape polyfill 存在（jsdom 不自带）
 */
export function ensureCSSPolyfill(): void {
  if (typeof CSS === "undefined" || !CSS.escape) {
    ;(global as any).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    }
  }
}
