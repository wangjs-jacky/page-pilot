import type { ElementCapture } from "../lib/types"

let pickerActive = false
let hoveredElement: Element | null = null

// 高亮样式
const HIGHLIGHT_STYLE = `
  outline: 2px solid #00d4ff !important;
  outline-offset: 2px !important;
  background-color: rgba(0, 212, 255, 0.1) !important;
  cursor: crosshair !important;
`

function getOrCreateStyleEl(): HTMLStyleElement {
  let el = document.getElementById("pagepilot-highlight-style") as HTMLStyleElement
  if (!el) {
    el = document.createElement("style")
    el.id = "pagepilot-highlight-style"
    el.textContent = `.pagepilot-highlight { ${HIGHLIGHT_STYLE} }`
    document.head.appendChild(el)
  }
  return el
}

function clearHighlight() {
  if (hoveredElement) {
    hoveredElement.classList.remove("pagepilot-highlight")
    hoveredElement = null
  }
}

function calculateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`

  const classes = Array.from(el.classList).filter(
    (c) => !c.startsWith("css-") && !c.startsWith("sc-") && !c.startsWith("_")
  )
  if (classes.length > 0) {
    const tag = el.tagName.toLowerCase()
    const classSel = `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`
    if (el.parentElement && el.parentElement.querySelectorAll(classSel).length === 1) {
      return classSel
    }
  }

  let parent = el.parentElement
  let depth = 0
  while (parent && depth < 5) {
    if (parent.id) {
      return `#${CSS.escape(parent.id)} ${getRelativePath(parent, el)}`
    }
    parent = parent.parentElement
    depth++
  }

  return getNthChildPath(el)
}

function getRelativePath(ancestor: Element, descendant: Element): string {
  const parts: string[] = []
  let current: Element | null = descendant
  while (current && current !== ancestor) {
    const tag = current.tagName.toLowerCase()
    const idx = Array.from(current.parentElement!.children).indexOf(current) + 1
    parts.unshift(`${tag}:nth-child(${idx})`)
    current = current.parentElement
  }
  return parts.join(" > ")
}

function getNthChildPath(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase()
    const idx = Array.from(current.parentElement!.children).indexOf(current) + 1
    parts.unshift(`${tag}:nth-child(${idx})`)
    current = current.parentElement
  }
  return parts.join(" > ")
}

// --- 富 DOM 序列化 ---

const MAX_HTML_LENGTH = 4000
const MAX_PAGINATION_HTML_LENGTH = 2000
const MAX_SIBLING_HTML_LENGTH = 1500
const MAX_SIBLING_SAMPLES = 3

// 自动检测页面分页区域
function detectPaginationArea(): string | null {
  const paginationSelectors = [
    "nav",
    '[role="navigation"]',
    ".pagination",
    ".pager",
    ".page-nav",
    '[class*="pagination"]',
    '[class*="pager"]',
    "ul.page-numbers",
    ".pages",
    ".page-list",
    ".pageination",
  ]

  for (const sel of paginationSelectors) {
    try {
      const elements = document.querySelectorAll(sel)
      for (const el of elements) {
        // 检查是否包含链接或按钮（分页区域的特征）
        const hasLinks = el.querySelectorAll("a, button").length >= 2
        // 检查是否包含数字文本（页码特征）
        const hasNumberText = /[2-9]|\d{2,}/.test(el.textContent || "")
        if (hasLinks && hasNumberText) {
          const clone = el.cloneNode(true) as Element
          clone.querySelectorAll("script, style, svg").forEach((n) => n.remove())
          let html = clone.outerHTML
          if (html.length > MAX_PAGINATION_HTML_LENGTH) {
            html = html.slice(0, MAX_PAGINATION_HTML_LENGTH) + "\n<!-- ... 截断 ... -->"
          }
          return html
        }
      }
    } catch {
      // 无效选择器，跳过
    }
  }

  return null
}

// 获取元素的通用选择器（不含 nth-child），用于计算同级元素
function getGenericSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const classes = Array.from(el.classList).filter(
    (c) => !c.startsWith("css-") && !c.startsWith("sc-") && !c.startsWith("_") && !c.startsWith("data-v-")
  )
  if (classes.length > 0) {
    return `${tag}.${classes.map((c) => CSS.escape(c)).join(".")}`
  }
  return tag
}

// 序列化元素 HTML，去除冗余内容并截断
function serializeElement(el: Element): string {
  const clone = el.cloneNode(true) as Element

  // 去除 script、style、svg 标签
  clone.querySelectorAll("script, style, svg").forEach((node) => node.remove())

  // 去除事件处理属性
  clone.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      if (attr.name.startsWith("on")) {
        node.removeAttribute(attr.name)
      }
    })
  })

  let html = clone.outerHTML

  // 如果超长，截断并标记
  if (html.length > MAX_HTML_LENGTH) {
    html = html.slice(0, MAX_HTML_LENGTH) + "\n<!-- ... 截断 ... -->"
  }

  return html
}

// 捕获同级卡片样本（最多 3 个，供 AI 分析 DOM 变化）
function captureSiblingSamples(el: Element): string[] {
  const parent = el.parentElement
  if (!parent) return []

  const genericSelector = getGenericSelector(el)
  const siblings = parent.querySelectorAll(`:scope > ${genericSelector}`)

  const samples: string[] = []
  for (let i = 0; i < siblings.length && samples.length < MAX_SIBLING_SAMPLES; i++) {
    const sibling = siblings[i]
    // 跳过被选中的元素本身
    if (sibling === el) continue
    const clone = sibling.cloneNode(true) as Element
    clone.querySelectorAll("script, style, svg").forEach((n) => n.remove())
    let html = clone.outerHTML
    if (html.length > MAX_SIBLING_HTML_LENGTH) {
      html = html.slice(0, MAX_SIBLING_HTML_LENGTH) + "\n<!-- ... 截断 ... -->"
    }
    samples.push(html)
  }
  return samples
}

// 检测同级同类元素
function detectSiblings(el: Element): { siblingCount: number; parentContext: string } {
  const parent = el.parentElement
  if (!parent) {
    return { siblingCount: 1, parentContext: "" }
  }

  const genericSelector = getGenericSelector(el)
  const siblings = parent.querySelectorAll(`:scope > ${genericSelector}`)

  // 序列化父容器结构（只包含直接子元素的标签+类名）
  const childSummaries = Array.from(parent.children).map((child) => {
    const tag = child.tagName.toLowerCase()
    const classes = Array.from(child.classList).slice(0, 3).join(".")
    return classes ? `<${tag} class="${classes}">` : `<${tag}>`
  })

  const parentTag = parent.tagName.toLowerCase()
  const parentClasses = Array.from(parent.classList).slice(0, 3).join(".")
  const parentStr = parentClasses
    ? `<${parentTag} class="${parentClasses}"> [${childSummaries.join(", ")}]</${parentTag}>`
    : `<${parentTag}> [${childSummaries.join(", ")}]</${parentTag}>`

  return {
    siblingCount: siblings.length,
    parentContext: parentStr,
  }
}

function onMouseOver(e: MouseEvent) {
  if (!pickerActive) return
  const target = e.target as Element
  if (target === document.body || target === document.documentElement) return
  clearHighlight()
  hoveredElement = target
  target.classList.add("pagepilot-highlight")
}

function onMouseOut(e: MouseEvent) {
  if (!pickerActive) return
  clearHighlight()
}

function onClick(e: MouseEvent) {
  if (!pickerActive) return
  e.preventDefault()
  e.stopPropagation()
  const target = e.target as Element
  const selector = calculateSelector(target)
  const text = target.textContent?.trim().slice(0, 50) || ""

  // 富 DOM 捕获
  const outerHTML = serializeElement(target)
  const { siblingCount, parentContext } = detectSiblings(target)
  const paginationContext = detectPaginationArea()
  const siblingSamples = captureSiblingSamples(target)

  const capture: ElementCapture = {
    selector,
    tagName: target.tagName.toLowerCase(),
    text,
    outerHTML,
    parentContext,
    siblingCount,
    ...(paginationContext && { paginationContext }),
    ...(siblingSamples.length > 0 && { siblingSamples }),
  }

  chrome.runtime.sendMessage({
    type: "ELEMENT_SELECTED",
    payload: capture,
  })
}

function startPicker() {
  pickerActive = true
  getOrCreateStyleEl()
  document.addEventListener("mouseover", onMouseOver, true)
  document.addEventListener("mouseout", onMouseOut, true)
  document.addEventListener("click", onClick, true)
}

function stopPicker() {
  pickerActive = false
  clearHighlight()
  document.removeEventListener("mouseover", onMouseOver, true)
  document.removeEventListener("mouseout", onMouseOut, true)
  document.removeEventListener("click", onClick, true)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[PagePilot Picker] 收到消息:", message.type)
  if (message.type === "PAGEPILOT_PING") {
    sendResponse("PAGEPILOT_PONG")
  } else if (message.type === "START_PICKER") {
    console.log("[PagePilot Picker] 启动选择器")
    startPicker()
  } else if (message.type === "STOP_PICKER") {
    console.log("[PagePilot Picker] 停止选择器")
    stopPicker()
  }
})
