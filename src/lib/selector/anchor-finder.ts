import type { SemanticAnchor } from "../types"

/**
 * 从目标元素出发，查找附近 DOM 中有稳定属性的元素作为语义锚点。
 * 锚点用于：当主选择器失效时，通过锚点 + 相对路径重新定位目标。
 */

const MAX_ANCHOR_DISTANCE = 5
const MAX_ANCHORS = 3

// 判断一个元素是否适合做锚点
function getAnchorScore(el: Element): { type: SemanticAnchor["anchorType"]; value: string; score: number } | null {
  // 1. data-* 属性（最稳定）
  const dataAttrs = ["data-testid", "data-cy", "data-id", "data-qa", "data-role"]
  for (const attr of dataAttrs) {
    const value = el.getAttribute(attr)
    if (value) {
      return { type: "data-attr", value: `${attr}=${value}`, score: 95 }
    }
  }

  // 2. aria 属性
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel && ariaLabel.length < 100) {
    return { type: "aria-attr", value: `aria-label=${ariaLabel}`, score: 88 }
  }

  const role = el.getAttribute("role")
  if (role) {
    return { type: "aria-attr", value: `role=${role}`, score: 82 }
  }

  // 3. 稳定的 id
  if (el.id && isStableId(el.id)) {
    return { type: "id", value: el.id, score: 85 }
  }

  // 4. 文本内容（短且有意义的文本）
  const text = el.textContent?.trim()
  if (text && text.length >= 2 && text.length <= 50 && el.children.length === 0) {
    // 排除纯数字和特殊字符
    if (!/^\d+$/.test(text) && /[a-zA-Z\u4e00-\u9fff]/.test(text)) {
      return { type: "text-content", value: text, score: 60 }
    }
  }

  return null
}

function isStableId(id: string): boolean {
  if (/^\d+$/.test(id)) return false
  if (/^[a-z0-9-]{20,}$/i.test(id) && !/[a-z]{3,}/i.test(id)) return false
  if (/^(rb-|ui-id-|automount-)/.test(id)) return false
  return true
}

// 计算从祖先到后代的相对路径（简化版，不含 nth-child 除非必要）
function computeRelativePath(ancestor: Element, target: Element): string {
  const parts: string[] = []
  let current: Element | null = target

  while (current && current !== ancestor) {
    const tag = current.tagName.toLowerCase()

    // 尝试用语义 class
    const classes = Array.from(current.classList).filter(c =>
      !c.startsWith("css-") && !c.startsWith("sc-") && !c.startsWith("_") && !c.startsWith("data-v-") && c.length >= 3
    )

    if (classes.length > 0) {
      const classSel = `${tag}.${classes.map(c => CSS.escape(c)).join(".")}`
      if (current.parentElement && current.parentElement.querySelectorAll(`:scope > ${classSel}`).length === 1) {
        parts.unshift(classSel)
        current = current.parentElement
        continue
      }
    }

    // 降级到 nth-child
    const idx = Array.from(current.parentElement!.children).indexOf(current) + 1
    parts.unshift(`${tag}:nth-child(${idx})`)
    current = current.parentElement
  }

  return parts.join(" > ")
}

// 构建锚点的 CSS 选择器
function buildAnchorSelector(el: Element, anchorInfo: { type: SemanticAnchor["anchorType"]; value: string }): string {
  const tag = el.tagName.toLowerCase()

  switch (anchorInfo.type) {
    case "data-attr": {
      // value 格式: "attr=value"
      const [attr, ...rest] = anchorInfo.value.split("=")
      const val = rest.join("=")
      return `${tag}[${CSS.escape(attr)}="${CSS.escape(val)}"]`
    }
    case "aria-attr": {
      if (anchorInfo.value.startsWith("aria-label=")) {
        const val = anchorInfo.value.slice("aria-label=".length)
        return `${tag}[aria-label="${CSS.escape(val)}"]`
      }
      if (anchorInfo.value.startsWith("role=")) {
        const val = anchorInfo.value.slice("role=".length)
        return `${tag}[role="${CSS.escape(val)}"]`
      }
      return tag
    }
    case "id":
      return `#${CSS.escape(anchorInfo.value)}`
    case "text-content":
      // 文本锚点无法直接用 CSS，返回标签选择器作为提示
      return tag
  }
}

/**
 * 查找目标元素附近的语义锚点
 *
 * @param target 目标元素
 * @param maxDistance 最大搜索距离（DOM 层级），默认 5
 * @returns 按质量排序的锚点列表，最多 3 个
 */
export function findSemanticAnchors(target: Element, maxDistance: number = MAX_ANCHOR_DISTANCE): SemanticAnchor[] {
  const anchors: SemanticAnchor[] = []

  // 1. 向上搜索祖先
  let parent = target.parentElement
  let distance = 1

  while (parent && distance <= maxDistance) {
    const anchorInfo = getAnchorScore(parent)
    if (anchorInfo) {
      const relPath = computeRelativePath(parent, target)
      anchors.push({
        selector: buildAnchorSelector(parent, anchorInfo),
        anchorType: anchorInfo.type,
        anchorValue: anchorInfo.value,
        relativePath: relPath,
        distance,
      })
    }

    parent = parent.parentElement
    distance++
  }

  // 2. 搜索兄弟元素
  const parentEl = target.parentElement
  if (parentEl) {
    const siblings = Array.from(parentEl.children)
    for (const sibling of siblings) {
      if (sibling === target) continue
      const anchorInfo = getAnchorScore(sibling)
      if (anchorInfo) {
        // 兄弟距离 = 2（先到父再到兄弟）
        anchors.push({
          selector: buildAnchorSelector(sibling, anchorInfo),
          anchorType: anchorInfo.type,
          anchorValue: anchorInfo.value,
          relativePath: "", // 兄弟之间没有直接的相对路径
          distance: 2,
        })
      }
    }
  }

  // 3. 按质量排序：稳定性 / 距离
  anchors.sort((a, b) => {
    const scoreA = getAnchorTypeScore(a.anchorType) / a.distance
    const scoreB = getAnchorTypeScore(b.anchorType) / b.distance
    return scoreB - scoreA
  })

  // 返回前 N 个
  return anchors.slice(0, MAX_ANCHORS)
}

function getAnchorTypeScore(type: SemanticAnchor["anchorType"]): number {
  switch (type) {
    case "data-attr": return 95
    case "id": return 85
    case "aria-attr": return 80
    case "text-content": return 55
  }
}

// 导出辅助函数供测试使用
export const _internal = {
  getAnchorScore,
  computeRelativePath,
  buildAnchorSelector,
}
