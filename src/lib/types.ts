// 提取脚本
export interface ExtractionScript {
  id: string
  name: string
  urlPatterns: string[]
  fields: FieldMapping[]
  code: string
  createdAt: number
  lastExecutedAt?: number
}

// 字段映射
export interface FieldMapping {
  name: string
  selector: string
  attribute: string // textContent | innerHTML | href | src | ...
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
  | { type: "ELEMENT_SELECTED"; payload: { selector: string; tagName: string; text: string } }
  | { type: "EXECUTE_SCRIPT"; payload: { code: string } }
  | { type: "SCRIPT_RESULT"; payload: { data: Record<string, any>[] } }
  | { type: "URL_MATCHED"; payload: { scriptIds: string[] } }

// SidePanel 视图状态
export type ViewState =
  | { view: "library" }
  | { view: "picker"; scriptId?: string }
  | { view: "preview"; tempScript: Omit<ExtractionScript, "id" | "createdAt"> }
  | { view: "result"; result: ExtractionResult }
