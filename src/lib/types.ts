// --- 富 DOM 捕获 ---

export interface ElementCapture {
  selector: string
  tagName: string
  text: string
  outerHTML: string      // 截断到 ~4000 字符
  parentContext: string   // 父容器结构摘要
  siblingCount: number    // 同级同类元素数量
}

// --- AI 分析 ---

export interface AIFieldCandidate {
  name: string           // 英文驼峰，如 title, viewCount
  selector: string       // 卡片内相对 CSS 选择器
  attribute: string      // textContent | href | src | ...
  sampleValue: string    // AI 从 HTML 中看到的示例值
  confidence: "high" | "medium" | "low"
}

export interface AIAnalysisResult {
  cardSelector: string         // 单个卡片选择器（无 nth-child）
  containerSelector: string    // 卡片列表容器选择器
  fields: AIFieldCandidate[]
  paginationHint: {
    nextButtonSelector: string | null
    estimatedPages: number | null
  } | null
}

// --- 分页配置 ---

export interface PaginationConfig {
  enabled: boolean
  mode: "click" | "scroll" | "url"
  nextButtonSelector: string
  maxPages: number
  waitMs: number    // 翻页后等待时间，默认 2000ms
}

// --- 智能选择器步骤 ---

export type SmartPickerStep =
  | { step: "select" }
  | { step: "analyzing"; capture: ElementCapture }
  | { step: "confirm"; capture: ElementCapture; analysis: AIAnalysisResult; fields: AIFieldCandidate[] }
  | { step: "configure-pagination"; capture: ElementCapture; analysis: AIAnalysisResult; fields: AIFieldCandidate[]; pagination: PaginationConfig }

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
}

// 字段映射
export interface FieldMapping {
  name: string
  selector: string
  attribute: string // textContent | innerHTML | href | src | ...
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

// SidePanel 视图状态
export type ViewState =
  | { view: "library" }
  | { view: "picker"; scriptId?: string; pickerStep?: SmartPickerStep }
  | { view: "preview"; scriptId?: string; tempScript: Omit<ExtractionScript, "id" | "createdAt">; autoOpenOptimize?: boolean; executionResult?: Record<string, any>[] }
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
