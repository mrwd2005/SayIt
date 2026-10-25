import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => ({
  addMsg: vi.fn(),
}))

vi.mock('../debugLog', () => ({
  addMsg: log.addMsg,
  addAudioChunk: () => {},
  startSession: () => {},
  endSession: () => {},
  addRuntimeEvent: () => {},
  hasActiveSession: () => false,
}))
vi.mock('../runtimeConfig', () => ({ getWSUrl: () => 'ws://test/ws/transcribe' }))
vi.mock('../../stores/connectionStatus', () => ({ setConnectionStatus: () => {} }))

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor() {
    FakeSocket.last = this
  }

  send() {}
  close() {}

  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

describe('websocket partial messages', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
    log.addMsg.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('forwards cumulative partial text without adding one log entry per message', async () => {
    const ws = await import('../websocket')
    const onPartial = vi.fn()
    const onFinal = vi.fn()
    const pending = ws.connect({ onPartial, onFinal })
    FakeSocket.last!.open()
    await pending

    FakeSocket.last!.emit({ type: 'partial', text: '这个' })
    FakeSocket.last!.emit({ type: 'partial', text: '这个不能够' })
    FakeSocket.last!.emit({
      type: 'final',
      asr_text: '这个不能够及时',
      llm_text: '',
      asr_ms: 0,
      llm_ms: 0,
      duration_sec: 2,
    })

    expect(onPartial.mock.calls.map((call) => call[0])).toEqual(['这个', '这个不能够'])
    expect(onFinal).toHaveBeenCalledTimes(1)
    expect(log.addMsg.mock.calls.map((call) => call[1])).toEqual(['final'])
    ws.disconnect()
  })
})
