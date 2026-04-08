/**
 * Bridge Client — MCP Server 通过此客户端连接到独立 Bridge Server
 *
 * 提供与原 Bridge 类相同的 API:
 * - sendRequest(tool, args, timeout) → Promise<any>
 * - bridgeReady: boolean
 * - isConnected: boolean
 */

import WebSocket from "ws"
import { isBridgeRunning, spawnBridgeProcess } from "./bridge-server.js"

const BRIDGE_URL = "ws://localhost:9527"
const RECONNECT_INTERVAL = 3000

type PendingRequest = {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BridgeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, PendingRequest>()
  private msgCounter = 0
  private _connected = false
  private _ready = false

  constructor() {
    this._ready = true // 客户端本身总是 ready，Bridge 可能还没连上
  }

  /** 启动连接（自动拉起 Bridge） */
  async connect(): Promise<void> {
    // 确保 Bridge 在运行
    if (!isBridgeRunning()) {
      spawnBridgeProcess()
      // 等待 Bridge 启动
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100))
        if (isBridgeRunning()) break
      }
    }

    if (!isBridgeRunning()) {
      throw new Error("Bridge 启动失败")
    }

    // 带重试的连接，最多 5 次
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.doConnect(resolve, reject)
        })
        return // 连接成功
      } catch {
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    }
    throw new Error("Bridge 连接失败")
  }

  private doConnect(
    onFirstConnect?: (() => void) | undefined,
    onFirstConnectFail?: ((err: Error) => void) | undefined
  ) {
    let settled = false
    const onSuccess = () => {
      if (settled) return
      settled = true
      onFirstConnect?.()
    }
    const onFail = (err: Error) => {
      if (settled) return
      settled = true
      onFirstConnectFail?.(err)
    }

    try {
      this.ws = new WebSocket(BRIDGE_URL)
    } catch {
      this.scheduleReconnect()
      onFail(new Error("WebSocket 创建失败"))
      return
    }

    this.ws.on("open", () => {
      // 发送注册消息
      this.ws!.send(JSON.stringify({ type: "register", role: "mcp" }))
      console.error("[BridgeClient] 已连接到 Bridge Server")
    })

    this.ws.on("message", (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString())

        // 注册确认
        if (msg.type === "registered") {
          this._connected = true
          onSuccess()
          return
        }

        // 工具调用响应
        if (msg.type === "tool_response" && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!
          clearTimeout(pending.timer)
          this.pending.delete(msg.id)
          if (msg.error) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
        }
      } catch (e) {
        console.error("[BridgeClient] 处理消息失败:", e.message || e)
      }
    })

    this.ws.on("close", () => {
      this._connected = false
      this.ws = null
      console.error("[BridgeClient] 连接断开")
      onFail(new Error("连接关闭"))
      this.scheduleReconnect()
    })

    this.ws.on("error", (err) => {
      console.error(`[BridgeClient] 连接错误: ${err.message}`)
      onFail(err)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, RECONNECT_INTERVAL)
  }

  /** Bridge 客户端是否就绪 */
  get bridgeReady(): boolean {
    return this._ready
  }

  /** 是否已连接到 Bridge Server */
  get isConnected(): boolean {
    return this._connected
  }

  /**
   * 发送工具调用请求（与原 Bridge 相同的 API）
   */
  async sendRequest(tool: string, args: Record<string, any>, timeout = 30000): Promise<any> {
    if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge 未连接。请确认 Bridge Server 已启动且 Chrome Extension 已连接。")
    }

    const id = `req_${++this.msgCounter}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`工具调用超时 (${tool}, ${timeout}ms)`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })

      this.ws!.send(
        JSON.stringify({
          type: "tool_call",
          id,
          tool,
          args,
        })
      )
    })
  }

  /** 断开连接 */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this._connected = false

    // 清理待处理请求
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error("客户端已断开"))
    }
    this.pending.clear()
  }
}
