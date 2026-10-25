import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WSCallbacks } from '../../websocket'

let wsCallbacks: WSCallbacks = {}

vi.mock('../../websocket', () => ({
  connect: (callbacks: WSCallbacks) => {
    wsCallbacks = callbacks
    return Promise.resolve()
  },
  sendStart: () => true,
  sendStop: () => true,
  sendAudio: () => {},
  disconnect: () => {},
  isConnected: () => true,
}))
vi.mock('../../store', () => ({
  getSetting: (_key: string, fallback: unknown) => Promise.resolve(fallback),
}))
vi.mock('../../debugLog', () => ({ addRuntimeEvent: () => {} }))
vi.mock('../clientAiPolish', () => ({ polishWithClientAi: vi.fn() }))

import { ServerProvider } from '../ServerProvider'

async function connected() {
  const onPartialASR = vi.fn()
  const provider = new ServerProvider()
  await provider.connect({ onPartialASR })
  return { provider, onPartialASR }
}

describe('server-mode live captions', () => {
  beforeEach(() => {
    wsCallbacks = {}
  })

  it('forwards cumulative partial text when live captions are enabled', async () => {
    const { provider, onPartialASR } = await connected()
    provider.start({ runId: 1, streamingDisplay: true })
    wsCallbacks.onPartial?.('这个')
    wsCallbacks.onPartial?.('这个不能够及时')
    expect(onPartialASR.mock.calls.map((call) => call[0])).toEqual([
      '这个',
      '这个不能够及时',
    ])
  })

  it('ignores partial messages when live captions are disabled', async () => {
    const { provider, onPartialASR } = await connected()
    provider.start({ runId: 1, streamingDisplay: false })
    wsCallbacks.onPartial?.('这个')
    expect(onPartialASR).not.toHaveBeenCalled()
  })

  it('drops late partial messages after done', async () => {
    const { provider, onPartialASR } = await connected()
    provider.start({ runId: 1, streamingDisplay: true })
    wsCallbacks.onDone?.()
    wsCallbacks.onPartial?.('迟到的字')
    expect(onPartialASR).not.toHaveBeenCalled()
    provider.disconnect()
  })

  it('drops partial messages after cancellation', async () => {
    const { provider, onPartialASR } = await connected()
    provider.start({ runId: 2, streamingDisplay: true })
    provider.cancel()
    wsCallbacks.onPartial?.('取消后的字')
    expect(onPartialASR).not.toHaveBeenCalled()
  })
})
