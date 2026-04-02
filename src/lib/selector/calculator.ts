/**
 * 为一个 DOM 元素计算最优 CSS 选择器
 * 优先级：id > 唯一 class > 向上找 id 祖先 > nth-child 路径
 */
export function calculateSelector(el: Element): string {
  // 策略 1：元素有 id
  if (el.id) {
    return `#${CSS.escape(el.id)}`
  }

  // 策略 2：元素的 class 组合在兄弟中唯一
  const classSelector = getClassSelector(el)
  if (classSelector && isUniqueInParent(el, classSelector)) {
    return classSelector
  }

  // 策略 3：向上追溯到有 id 的祖先
  const ancestorWithId = findAncestorWithId(el)
  if (ancestorWithId) {
    const path = getPathBetween(ancestorWithId, el)
    return `#${CSS.escape(ancestorWithId.id)} ${path}`
  }

  // 策略 4：完整 nth-child 路径
  return getNthChildPath(el)
}

function getClassSelector(el: Element): string | null {
  if (el.classList.length === 0) return null
  const tagName = el.tagName.toLowerCase()
  // 优先只用第一个有意义的 class
  const classes = Array.from(el.classList).filter(
    (c) => !c.startsWith("css-") && !c.startsWith("sc-") && !c.startsWith("_")
  )
  if (classes.length === 0) return null
  return `${tagName}.${classes.map((c) => CSS.escape(c)).join(".")}`
}

function isUniqueInParent(el: Element, selector: string): boolean {
  if (!el.parentElement) return true
  const siblings = el.parentElement.querySelectorAll(selector)
  return siblings.length === 1
}

function findAncestorWithId(el: Element): Element | null {
  let parent = el.parentElement
  const MAX_DEPTH = 5
  let depth = 0
  while (parent && depth < MAX_DEPTH) {
    if (parent.id) return parent
    parent = parent.parentElement
    depth++
  }
  return null
}

function getPathBetween(ancestor: Element, descendant: Element): string {
  const parts: string[] = []
  let current: Element | null = descendant
  while (current && current !== ancestor) {
    const tagName = current.tagName.toLowerCase()
    const siblingIndex = getSiblingIndex(current)
    parts.unshift(siblingIndex > 0 ? `${tagName}:nth-child(${siblingIndex})` : tagName)
    current = current.parentElement
  }
  return parts.join(" > ")
}

function getSiblingIndex(el: Element): number {
  if (!el.parentElement) return 0
  const siblings = Array.from(el.parentElement.children)
  return siblings.indexOf(el) + 1
}

function getNthChildPath(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body && current !== document.documentElement) {
    const tagName = current.tagName.toLowerCase()
    const index = getSiblingIndex(current)
    parts.unshift(`${tagName}:nth-child(${index})`)
    current = current.parentElement
  }
  return parts.join(" > ")
}

/**
 * 获取元素的预览文本（用于 SidePanel 展示）
 */
export function getElementPreview(el: Element): string {
  const text = el.textContent?.trim().slice(0, 50) || ""
  return text || `<${el.tagName.toLowerCase()} />`
}

/**
 * 获取元素周围 DOM 上下文（给 AI 参考）
 */
export function getDOMContext(el: Element, depth = 2): string {
  let current: Element | null = el.parentElement
  let context = ""
  let level = 0
  while (current && level < depth) {
    const tag = current.tagName.toLowerCase()
    const id = current.id ? `#${current.id}` : ""
    const classes = current.classList.length > 0 ? `.${Array.from(current.classList).slice(0, 2).join(".")}` : ""
    const childCount = current.children.length
    context += `${"  ".repeat(level)}<${tag}${id}${classes}> (${childCount} children)\n`
    current = current.parentElement
    level++
  }
  return context
}
