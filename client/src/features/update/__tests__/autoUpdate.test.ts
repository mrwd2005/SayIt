import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  recorder: vi.fn(),
  check: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))
const pending = { version: '0.2.2', filePath: 'C:/Temp/SayIt-0.2.2.exe', sha512: 'verified' }

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/services/recorder', () => ({ getState: mocks.recorder }))
vi.mock('@/services/debugLog', () => ({ addRuntimeEvent: vi.fn() }))
vi.mock('@/services/store', () => ({
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}))
vi.mock('@/services/bridge', () => ({
  verifyUpdatePackage: vi.fn().mockResolvedValue(true),
  installDownloadedUpdate: mocks.install,
}))
vi.mock('@/services/runtimeConfig', () => ({
  getUpdateBaseUrl: () => 'https://updates.test',
  getOfficialUpdateBaseUrl: () => 'https://updates.test',
  isOfficialUpdateChannel: () => true,
}))
vi.mock('../updateChecker', () => ({
  checkVersionUpdate: mocks.check,
  compareVersions: () => 1,
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  mocks.recorder.mockReset().mockReturnValue('idle')
  mocks.install.mockReset().mockResolvedValue(undefined)
  mocks.check.mockReset().mockResolvedValue({ hasUpdate: false, latestVersion: '0.2.1', downloadUrl: null })
  mocks.getSetting.mockReset().mockImplementation(async (key: string, fallback: unknown) => (
    key === 'pendingUpdate' ? pending : fallback
  ))
  mocks.setSetting.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function service() {
  const update = await import('../autoUpdate')
  await update.startUpdateService()
  return update
}

describe('installing a pending update', () => {
  it('uses the restored package and asks the installer to reopen the app exactly once', async () => {
    const update = await service()
    await update.installPendingUpdate()
    await update.installPendingUpdate()
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith(pending.filePath, true)
    expect(update.getAutoUpdateState().phase).toBe('installing')
  })

  it.each(['recording', 'processing'])('does not restart while %s, including from About', async (state) => {
    const update = await service()
    mocks.recorder.mockReturnValue(state)
    await update.installPendingUpdate()
    expect(mocks.install).not.toHaveBeenCalled()
    expect(update.getAutoUpdateState().pending).toEqual(pending)
    expect(update.getAutoUpdateState().phase).toBe('idle')
  })

  it('retains the package after a launch failure and allows a retry', async () => {
    const update = await service()
    mocks.install.mockRejectedValueOnce(new Error('Launch failed'))
    await update.installPendingUpdate()
    expect(update.getAutoUpdateState()).toMatchObject({
      phase: 'idle', pending, installError: 'Error: Launch failed',
    })
    await update.installPendingUpdate()
    expect(mocks.install).toHaveBeenCalledTimes(2)
    expect(update.getAutoUpdateState().installError).toBeNull()
  })

  it('does not let a periodic check reset the installation lock', async () => {
    const update = await service()
    await update.installPendingUpdate()
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(update.getAutoUpdateState().phase).toBe('installing')
    expect(mocks.check).toHaveBeenCalledTimes(1)
    await update.installPendingUpdate()
    expect(mocks.install).toHaveBeenCalledTimes(1)
  })
})

describe('automatic update switch', () => {
  it('stops checks and discards a downloaded package when disabled', async () => {
    const update = await service()
    expect(mocks.check).toHaveBeenCalledTimes(1)

    await update.setAutoUpdateEnabled(false)
    expect(mocks.setSetting).toHaveBeenCalledWith('autoCheckUpdate', false)
    expect(update.getAutoUpdateState().pending).toBeNull()

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(mocks.check).toHaveBeenCalledTimes(1)
    await update.installPendingUpdate()
    expect(mocks.install).not.toHaveBeenCalled()
  })

  it('checks immediately when enabled again', async () => {
    const update = await service()
    await update.setAutoUpdateEnabled(false)
    await update.setAutoUpdateEnabled(true)
    expect(mocks.setSetting).toHaveBeenLastCalledWith('autoCheckUpdate', true)
    expect(mocks.check).toHaveBeenCalledTimes(2)
  })
})
