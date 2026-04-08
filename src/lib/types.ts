// --- 选择器稳定性系统 ---

export type SelectorStrategy =
  | "data-attr"       // data-testid, data-cy, data-id 等
  | "aria-attr"       // aria-label, aria-labelledby, role
  | "id"              // #id
  | "semantic-class"  // 业务语义 class（如 .product-name）
  | "attribute"       // name, href, src, alt, title, placeholder
  | "text-content"    // 文本匹配（辅助定位）
  | "hash-class"      // css-*, sc-*, _ 前缀（不稳定）
  | "nth-child"       // 结构位置（最脆弱）

export interface SelectorCandidate {
  selector: string
  strategy: SelectorStrategy
  stabilityScore: number  // 0-100
  isUnique: boolean       // 页面内是否唯一匹配
}

export interface SemanticAnchor {
  selector: string
  anchorType: "data-attr" | "aria-attr" | "id" | "text-content"
  anchorValue: string
  relativePath: string  // 从锚点到目标的相对路径
  distance: number      // DOM 层级距离
}

export interface StabilityWarning {
  level: "info" | "warning" | "danger"
  message: string    // 中文，UI 展示
  suggestion: string // 中文，改进建议
}

// --- 富 DOM 捕获 ---

export interface ElementCapture {
  selector: string
  tagName: string
  text: string
  outerHTML: string      // 截断到 ~4000 字符
  parentContext: string   // 父容器结构摘要
  siblingCount: number    // 同级同类元素数量
  paginationContext?: string  // 自动检测到的分页区域 HTML（截断到 ~2000 字符）
  siblingSamples?: string[]   // 最多 3 个同级卡片的 HTML 样本
  selectorCandidates?: SelectorCandidate[]  // 多策略候选选择器
  semanticAnchors?: SemanticAnchor[]         // 附近语义锚点
}

// --- AI 分析 ---

export interface AIFieldCandidate {
  name: string           // 英文驼峰，如 title, viewCount
  selector: string       // 卡片内相对 CSS 选择器
  attribute: string      // textContent | href | src | ...
  sampleValue: string    // AI 从 HTML 中看到的示例值
  confidence: "high" | "medium" | "low"
  selectorCandidates?: SelectorCandidate[]  // 多候选选择器（按稳定性排序）
  semanticAnchor?: SemanticAnchor            // 语义锚点
  stabilityWarning?: StabilityWarning       // 稳定性警告
}

export interface AIAnalysisResult {
  cardSelector: string         // 单个卡片选择器（无 nth-child）
  containerSelector: string    // 卡片列表容器选择器
  fields: AIFieldCandidate[]
  cardSelectorCandidates?: SelectorCandidate[]  // 卡片选择器候选
  paginationHint: {
    type: "click-next" | "numbered" | "scroll" | "url" | null
    nextButtonSelector: string | null
    pageButtonSelector: string | null  // numbered 模式：页码按钮通用选择器
    estimatedPages: number | null
  } | null
}

// --- 分页配置 ---

export interface PaginationConfig {
  enabled: boolean
  mode: "click" | "numbered" | "scroll" | "url"
  nextButtonSelector: string
  pageButtonSelector?: string  // numbered 模式：页码按钮通用选择器
  maxPages: number
  waitMs: number    // 翻页后等待时间，默认 2000ms
  nextButtonCapture?: ElementCapture  // 下一页按钮的完整元素信息，喂给 AI 理解翻页语义
}

// --- 智能选择器步骤 ---

export type SmartPickerStep =
  | { step: "select"; paginationCapture?: ElementCapture }
  | { step: "analyzing"; capture: ElementCapture; paginationCapture?: ElementCapture }
  | { step: "confirm"; capture: ElementCapture; analysis: AIAnalysisResult; fields: AIFieldCandidate[]; pagination?: PaginationConfig }

// 提取脚本
export interface ExtractionScript {
  id: string
  name: string
  urlPatterns: string[]
  fields: FieldMapping[]
  code: string
  createdAt: number
  lastExecutedAt?: number
  pagination?: PaginationConfig
  cardSelector?: string
  containerSelector?: string
  selectorVersion?: number  // 1=legacy, 2=robust
}

// 字段映射
export interface FieldMapping {
  name: string
  selector: string
  attribute: string // textContent | innerHTML | href | src | ...
  fallbackSelectors?: string[]      // 备选选择器（按优先级排序）
  semanticAnchor?: SemanticAnchor   // 语义锚点
  stabilityScore?: number           // 0-100
}

// 字段映射（来自 AI 分析确认后的）
export interface ConfirmedField {
  name: string
  selector: string
  attribute: string
  enabled: boolean
}

// AI 服务商配置
export interface AIProviderConfig {
  providerId: "kimi" | "zhipu" | "deepseek" | "openrouter"
  apiKey: string
  model: string
}

// 设置
export interface Settings {
  ai: AIProviderConfig
}

// 提取结果
export interface ExtractionResult {
  scriptId: string
  data: Record<string, any>[]
  executedAt: number
  duration: number
  count: number
}

// 消息类型
export type MessageType =
  | { type: "START_PICKER" }
  | { type: "STOP_PICKER" }
  | { type: "ELEMENT_SELECTED"; payload: ElementCapture }
  | { type: "EXECUTE_SCRIPT"; payload: { code: string } }
  | { type: "SCRIPT_RESULT"; payload: { data: Record<string, any>[] } }
  | { type: "URL_MATCHED"; payload: { scriptIds: string[] } }
  | { type: "EXECUTE_PAGINATED"; payload: { code: string; pagination: PaginationConfig } }
  | { type: "PAGINATED_PROGRESS"; payload: { page: number; maxPages: number; itemsSoFar: number } }
  | { type: "PAGINATION_STOP" }

// --- Dry-Run 验证 ---

export interface DryRunResult {
  success: boolean
  data?: Record<string, any>[]
  error?: string
  itemCount: number
  firstCardHTML?: string  // 空结果时捕获 DOM 快照供 AI 修复用
}

export interface AutoFixProgress {
  round: number       // 0=初始生成, 1-3=修复轮次
  maxRounds: number
  status: "generating" | "dry-running" | "fixing" | "success" | "failed"
  dryRunResult?: DryRunResult
}

// SidePanel 视图状态
export type ViewState =
  | { view: "library" }
  | { view: "picker"; scriptId?: string; pickerStep?: SmartPickerStep }
  | { view: "preview"; scriptId?: string; tempScript: Omit<ExtractionScript, "id" | "createdAt">; autoOpenOptimize?: boolean; executionResult?: Record<string, any>[]; dryRunResult?: DryRunResult }
  | { view: "result"; result: ExtractionResult; editContext?: { scriptId?: string; tempScript: Omit<ExtractionScript, "id" | "createdAt"> } }
  | { view: "claude-code"; mode: "idle" | "loading"; skills?: ClaudeCodeSkill[] }
  | { view: "claude-code-result"; result: ClaudeCodeResult }

// Claude Code Skill
export interface ClaudeCodeSkill {
  name: string
  description: string
}

// Claude Code 执行结果
export interface ClaudeCodeResult {
  id: string
  action: "invoke_skill" | "ask_prompt"
  skill?: string
  prompt?: string
  output: string
  executedAt: number
  duration: number
  error?: string
}
