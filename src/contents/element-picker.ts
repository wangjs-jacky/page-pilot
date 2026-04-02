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
  chrome.runtime.sendMessage({
    type: "ELEMENT_SELECTED",
    payload: { selector, tagName: target.tagName.toLowerCase(), text },
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_PICKER") {
    startPicker()
  } else if (message.type === "STOP_PICKER") {
    stopPicker()
  }
})
