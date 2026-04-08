import type { SelectorCandidate, SelectorStrategy } from "../types"

/**
 * 为一个 DOM 元素生成多策略候选选择器，按稳定性评分排序
 *
 * 策略优先级：
 * data-attr(90-100) > aria-attr(80-95) > id(85-95) > attribute(65-80)
 * > semantic-class(60-75) > text-content(50-60) > hash-class(20-35) > nth-child(10-20)
 */

// data-* 属性白名单（常见的测试/语义属性）
const DATA_ATTR_WHITELIST = [
  "data-testid", "data-cy", "data-id", "data-qa", "data-role",
  "data-test", "data-testing", "data-automation-id", "data-e2e",
]

// 判断 id 是否像自动生成的（随机字符串）
function isStableId(id: string): boolean {
  // 过滤掉明显自动生成的 id：纯数字、uuid 风格、超长 hash
  if (/^\d+$/.test(id)) return false
  if (/^[a-z0-9-]{20,}$/i.test(id) && !/[a-z]{3,}/i.test(id)) return false  // 长随机串（无连续3字母）
  if (/^(:?rb-|ui-id-|automount-|\:)/.test(id)) return false  // React/Polymer 自动 id
  return true
}

// 判断 class 是否为业务语义的（非 hash 类）
function isSemanticClass(className: string): boolean {
  if (className.startsWith("css-")) return false
  if (className.startsWith("sc-")) return false
  if (className.startsWith("_")) return false
  if (className.startsWith("data-v-")) return false
  if (className.length < 3) return false  // 太短的 class 不稳定
  // hash-like: 连续的大小写字母数字无分隔符
  if (/^[a-z]{1,2}[A-Z0-9]{6,}$/i.test(className)) return false
  return true
}

// 验证选择器在页面中是否唯一
function checkUniqueness(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

// --- 各策略评分函数 ---

function scoreDataAttr(el: Element): SelectorCandidate | null {
  const attrs = Array.from(el.attributes)
  for (const attr of attrs) {
    if (DATA_ATTR_WHITELIST.includes(attr.name)) {
      const selector = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`
      const score = 95
      return {
        selector: `${el.tagName.toLowerCase()}${selector}`,
        strategy: "data-attr",
        stabilityScore: score,
        isUnique: checkUniqueness(`${el.tagName.toLowerCase()}${selector}`),
      }
    }
    // 自定义 data-* 属性也给高分
    if (attr.name.startsWith("data-") && !DATA_ATTR_WHITELIST.includes(attr.name)) {
      const selector = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`
      const candidate: SelectorCandidate = {
        selector: `${el.tagName.toLowerCase()}${selector}`,
        strategy: "data-attr",
        stabilityScore: 90,
        isUnique: checkUniqueness(`${el.tagName.toLowerCase()}${selector}`),
      }
      // 值太长或像 hash 则降分
      if (attr.value.length > 50 || /^[a-f0-9]{10,}$/i.test(attr.value)) {
        candidate.stabilityScore = 70
      }
      return candidate
    }
  }
  return null
}

function scoreAriaAttr(el: Element): SelectorCandidate | null {
  const ariaAttrs = [
    { name: "aria-label", score: 90 },
    { name: "aria-labelledby", score: 85 },
    { name: "role", score: 80 },
    { name: "aria-describedby", score: 80 },
  ]

  for (const { name, score } of ariaAttrs) {
    const value = el.getAttribute(name)
    if (value) {
      const selector = `[${CSS.escape(name)}="${CSS.escape(value)}"]`
      return {
        selector: `${el.tagName.toLowerCase()}${selector}`,
        strategy: "aria-attr",
        stabilityScore: score,
        isUnique: checkUniqueness(`${el.tagName.toLowerCase()}${selector}`),
      }
    }
  }
  return null
}

function scoreId(el: Element): SelectorCandidate | null {
  if (!el.id || !isStableId(el.id)) return null
  const selector = `#${CSS.escape(el.id)}`
  return {
    selector,
    strategy: "id",
    stabilityScore: 90,
    isUnique: checkUniqueness(selector),
  }
}

function scoreAttribute(el: Element): SelectorCandidate | null {
  const stableAttrs = [
    { name: "name", score: 78 },
    { name: "href", score: 70 },
    { name: "src", score: 70 },
    { name: "alt", score: 75 },
    { name: "title", score: 75 },
    { name: "placeholder", score: 72 },
    { name: "type", score: 65 },
  ]

  for (const { name, score } of stableAttrs) {
    const value = el.getAttribute(name)
    if (value && value.length > 0 && value.length < 200) {
      // href/src 如果是动态 URL（含 timestamp、hash）则降分
      let adjustedScore = score
      if ((name === "href" || name === "src") && /[?&](t|ts|_)=\d/.test(value)) {
        adjustedScore -= 20
      }
      // 只取路径部分，不包含完整 URL
      const selector = `[${CSS.escape(name)}="${CSS.escape(value)}"]`
      return {
        selector: `${el.tagName.toLowerCase()}${selector}`,
        strategy: "attribute",
        stabilityScore: adjustedScore,
        isUnique: checkUniqueness(`${el.tagName.toLowerCase()}${selector}`),
      }
    }
  }
  return null
}

function scoreSemanticClass(el: Element): SelectorCandidate | null {
  const classes = Array.from(el.classList).filter(isSemanticClass)
  if (classes.length === 0) return null

  const tag = el.tagName.toLowerCase()
  // 尝试组合所有语义 class
  const fullSelector = `${tag}.${classes.map(c => CSS.escape(c)).join(".")}`
  const isUnique = checkUniqueness(fullSelector)

  // 评分：唯一的高分，不唯一的低分
  let score = isUnique ? 72 : 60
  // class 数量越多越稳定（更具体）
  if (classes.length >= 3) score += 3

  return {
    selector: fullSelector,
    strategy: "semantic-class",
    stabilityScore: score,
    isUnique,
  }
}

function scoreTextContent(el: Element): SelectorCandidate | null {
  const text = el.textContent?.trim()
  if (!text || text.length < 2 || text.length > 100) return null

  // 纯文本选择器不是标准 CSS，作为元数据供 AI 使用
  return {
    selector: `:text("${text.slice(0, 50)}")`,
    strategy: "text-content",
    stabilityScore: 55,
    isUnique: false, // 文本匹配无法用 querySelectorAll 验证
  }
}

function scoreHashClass(el: Element): SelectorCandidate | null {
  const hashClasses = Array.from(el.classList).filter(
    c => !isSemanticClass(c)
  )
  if (hashClasses.length === 0) return null

  const tag = el.tagName.toLowerCase()
  const selector = `${tag}.${hashClasses.slice(0, 2).map(c => CSS.escape(c)).join(".")}`

  return {
    selector,
    strategy: "hash-class",
    stabilityScore: 25,
    isUnique: checkUniqueness(selector),
  }
}

function scoreNthChild(el: Element): SelectorCandidate {
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase()
    const idx = Array.from(current.parentElement!.children).indexOf(current) + 1
    parts.unshift(`${tag}:nth-child(${idx})`)
    current = current.parentElement
  }

  return {
    selector: parts.join(" > "),
    strategy: "nth-child",
    stabilityScore: 15,
    isUnique: true, // nth-child 路径总是唯一的
  }
}

// --- 祖先锚定策略 ---

function scoreAnchored(el: Element): SelectorCandidate | null {
  // 向上找有稳定属性的祖先（最多 5 层）
  let parent = el.parentElement
  let depth = 0
  const MAX_DEPTH = 5

  while (parent && depth < MAX_DEPTH) {
    // 尝试 data-attr
    for (const attr of DATA_ATTR_WHITELIST) {
      const value = parent.getAttribute(attr)
      if (value) {
        const anchorSel = `[${CSS.escape(attr)}="${CSS.escape(value)}"]`
        const tag = parent.tagName.toLowerCase()
        const anchorFull = `${tag}${anchorSel}`
        const relPath = getRelativePath(parent, el)
        const selector = `${anchorFull} ${relPath}`
        return {
          selector,
          strategy: "data-attr",
          stabilityScore: Math.max(80 - depth * 5, 60),
          isUnique: checkUniqueness(selector),
        }
      }
    }

    // 尝试稳定的 id
    if (parent.id && isStableId(parent.id)) {
      const relPath = getRelativePath(parent, el)
      const selector = `#${CSS.escape(parent.id)} ${relPath}`
      return {
        selector,
        strategy: "id",
        stabilityScore: Math.max(80 - depth * 5, 60),
        isUnique: checkUniqueness(selector),
      }
    }

    // 尝试 aria 属性
    const ariaLabel = parent.getAttribute("aria-label")
    if (ariaLabel) {
      const anchorSel = `[aria-label="${CSS.escape(ariaLabel)}"]`
      const tag = parent.tagName.toLowerCase()
      const relPath = getRelativePath(parent, el)
      const selector = `${tag}${anchorSel} ${relPath}`
      return {
        selector,
        strategy: "aria-attr",
        stabilityScore: Math.max(75 - depth * 5, 55),
        isUnique: checkUniqueness(selector),
      }
    }

    parent = parent.parentElement
    depth++
  }

  return null
}

function getRelativePath(ancestor: Element, descendant: Element): string {
  const parts: string[] = []
  let current: Element | null = descendant
  while (current && current !== ancestor) {
    const tag = current.tagName.toLowerCase()
    // 如果在兄弟中唯一，用 tag.class；否则用 nth-child
    const classes = Array.from(current.classList).filter(isSemanticClass)
    if (classes.length > 0) {
      const classSel = `${tag}.${classes.map(c => CSS.escape(c)).join(".")}`
      if (current.parentElement && current.parentElement.querySelectorAll(classSel).length === 1) {
        parts.unshift(classSel)
        current = current.parentElement
        continue
      }
    }
    const idx = Array.from(current.parentElement!.children).indexOf(current) + 1
    parts.unshift(`${tag}:nth-child(${idx})`)
    current = current.parentElement
  }
  return parts.join(" > ")
}

// --- 主入口 ---

export function generateSelectorCandidates(el: Element): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = []

  // 按策略优先级依次尝试
  const strategies: Array<{ score: () => SelectorCandidate | null; weight: number }> = [
    { score: () => scoreDataAttr(el), weight: 100 },
    { score: () => scoreAriaAttr(el), weight: 95 },
    { score: () => scoreId(el), weight: 90 },
    { score: () => scoreAttribute(el), weight: 80 },
    { score: () => scoreSemanticClass(el), weight: 70 },
    { score: () => scoreAnchored(el), weight: 75 },
    { score: () => scoreTextContent(el), weight: 55 },
    { score: () => scoreHashClass(el), weight: 25 },
    { score: () => scoreNthChild(el), weight: 15 },
  ]

  const seen = new Set<string>()
  for (const { score } of strategies) {
    const candidate = score()
    if (candidate && !seen.has(candidate.selector)) {
      seen.add(candidate.selector)
      candidates.push(candidate)
    }
  }

  // 按稳定性评分降序排列
  candidates.sort((a, b) => b.stabilityScore - a.stabilityScore)

  return candidates
}

/**
 * 获取最佳选择器（向后兼容 calculateSelector）
 */
export function getBestSelector(el: Element): string {
  const candidates = generateSelectorCandidates(el)
  // 优先返回高评分且唯一的
  const best = candidates.find(c => c.isUnique && c.stabilityScore >= 60)
  return best?.selector ?? candidates[0]?.selector ?? ""
}

// 导出辅助函数供测试使用
export const _internal = {
  isStableId,
  isSemanticClass,
  scoreDataAttr,
  scoreAriaAttr,
  scoreId,
  scoreAttribute,
  scoreSemanticClass,
  scoreTextContent,
  scoreHashClass,
  scoreNthChild,
  scoreAnchored,
}
