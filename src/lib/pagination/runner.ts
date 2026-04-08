import type { PaginationConfig } from "../types"

export interface PaginationRuntimeOps {
  extract: (code: string) => Promise<unknown>
  clickNext: (selector: string) => Promise<boolean>
  clickNumbered: (selector: string, targetPage: number) => Promise<boolean>
  scrollToBottom: () => Promise<void>
  getCurrentUrl: () => Promise<string>
  navigateTo: (url: string) => Promise<void>
  waitForContent: (waitMs: number) => Promise<void>
}

export interface PaginationProgress {
  page: number
  maxPages: number
  itemsSoFar: number
}

export type PaginationStopReason =
  | "completed"
  | "stopped"
  | "duplicate-page"
  | "empty-page"
  | "invalid-selector"
  | "page-change-failed"
  | "url-pagination-unsupported"

export interface RunPaginatedExtractionResult {
  data: Record<string, any>[]
  pagesVisited: number
  stopReason: PaginationStopReason
}

interface RunPaginatedExtractionArgs {
  extractionCode: string
  pagination: PaginationConfig
  ops: PaginationRuntimeOps
  shouldContinue?: () => boolean
  onProgress?: (progress: PaginationProgress) => void | Promise<void>
}

function normalizeItems(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw as Record<string, any>[]
  if (raw == null) return []
  return [raw as Record<string, any>]
}

function getNextPageUrl(currentUrl: string): string | null {
  try {
    const url = new URL(currentUrl)
    const currentPage = Number.parseInt(url.searchParams.get("page") || "", 10)
    if (Number.isFinite(currentPage) && currentPage > 0) {
      url.searchParams.set("page", String(currentPage + 1))
      return url.toString()
    }
  } catch {
    // 非标准 URL，回退正则
  }

  const pageMatch = currentUrl.match(/([?&]page=)(\d+)/)
  if (!pageMatch) return null
  const currentPage = Number.parseInt(pageMatch[2], 10)
  if (!Number.isFinite(currentPage)) return null
  return currentUrl.replace(pageMatch[0], `${pageMatch[1]}${currentPage + 1}`)
}

export async function runPaginatedExtraction({
  extractionCode,
  pagination,
  ops,
  shouldContinue,
  onProgress,
}: RunPaginatedExtractionArgs): Promise<RunPaginatedExtractionResult> {
  const allResults: Record<string, any>[] = []
  let previousFirstItemSignature = ""
  let pagesVisited = 0

  for (let page = 1; page <= pagination.maxPages; page++) {
    if (shouldContinue && !shouldContinue()) {
      return { data: allResults, pagesVisited, stopReason: "stopped" }
    }

    const items = normalizeItems(await ops.extract(extractionCode))
    pagesVisited = page

    if (items.length === 0) {
      return { data: allResults, pagesVisited, stopReason: "empty-page" }
    }

    if (page > 1) {
      const signature = JSON.stringify(items[0])
      if (signature === previousFirstItemSignature) {
        return { data: allResults, pagesVisited, stopReason: "duplicate-page" }
      }
    }

    previousFirstItemSignature = JSON.stringify(items[0])
    allResults.push(...items)

    await onProgress?.({
      page,
      maxPages: pagination.maxPages,
      itemsSoFar: allResults.length,
    })

    if (page >= pagination.maxPages) {
      return { data: allResults, pagesVisited, stopReason: "completed" }
    }

    let pageChanged = false

    if (pagination.mode === "click") {
      if (!pagination.nextButtonSelector?.trim()) {
        return { data: allResults, pagesVisited, stopReason: "invalid-selector" }
      }
      pageChanged = await ops.clickNext(pagination.nextButtonSelector)
    } else if (pagination.mode === "numbered") {
      if (!pagination.pageButtonSelector?.trim()) {
        return { data: allResults, pagesVisited, stopReason: "invalid-selector" }
      }
      pageChanged = await ops.clickNumbered(pagination.pageButtonSelector, page + 1)
    } else if (pagination.mode === "scroll") {
      await ops.scrollToBottom()
      pageChanged = true
    } else if (pagination.mode === "url") {
      const nextUrl = getNextPageUrl(await ops.getCurrentUrl())
      if (!nextUrl) {
        return { data: allResults, pagesVisited, stopReason: "url-pagination-unsupported" }
      }
      await ops.navigateTo(nextUrl)
      pageChanged = true
    }

    if (!pageChanged && (pagination.mode === "click" || pagination.mode === "numbered")) {
      return { data: allResults, pagesVisited, stopReason: "page-change-failed" }
    }

    await ops.waitForContent(pagination.waitMs)
  }

  return { data: allResults, pagesVisited, stopReason: "completed" }
}
