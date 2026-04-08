import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({} as CloseEvent)
  }

  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({} as Event)
  }

  triggerUnexpectedClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({} as CloseEvent)
  }
}

describe("ws-client reconnect behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWebSocket.instances = []

    ;(globalThis as any).WebSocket = FakeWebSocket
    ;(globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
      tabs: {
        query: vi.fn(),
        update: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("非手动断开后应自动重连", async () => {
    const client = await import("./ws-client")

    client.connectMCPBridge()
    expect(FakeWebSocket.instances).toHaveLength(1)

    const first = FakeWebSocket.instances[0]
    first.triggerOpen()
    first.triggerUnexpectedClose()

    vi.advanceTimersByTime(3000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it("手动 disconnect 后不应自动重连", async () => {
    const client = await import("./ws-client")

    client.connectMCPBridge()
    expect(FakeWebSocket.instances).toHaveLength(1)

    const first = FakeWebSocket.instances[0]
    first.triggerOpen()
    client.disconnectMCPBridge()

    vi.advanceTimersByTime(6000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
