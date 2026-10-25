import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/i18n/useT'
import { getAutoUpdateEnabled, setAutoUpdateEnabled } from '@/features/update/autoUpdate'

/**
 * 自动更新开关关闭后立即停止周期检查，并清除已经下载的待安装包。
 * 本地定制版可以通过这个开关长期固定在自己的构建上。
 */
export default function AppSection({
  autoLaunch,
  onToggleAutoLaunch,
  ready = true,
  animate = true,
}: {
  autoLaunch: boolean
  onToggleAutoLaunch: () => void
  ready?: boolean
  animate?: boolean
}) {
  const t = useT()
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateSaving, setUpdateSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void getAutoUpdateEnabled()
      .then((enabled) => { if (alive) setAutoUpdate(enabled) })
      .finally(() => { if (alive) setUpdateReady(true) })
    return () => { alive = false }
  }, [])

  const toggleAutoUpdate = async () => {
    const next = !autoUpdate
    setAutoUpdate(next)
    setUpdateSaving(true)
    try {
      await setAutoUpdateEnabled(next)
    } catch {
      setAutoUpdate(!next)
    } finally {
      setUpdateSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-lg font-semibold">{t('settings.app.title')}</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t('settings.app.autoLaunch')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.app.autoLaunchDesc')}</p>
          </div>
          <Switch checked={autoLaunch} onChange={onToggleAutoLaunch} noAnimation={!animate} hidden={!ready} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium">{t('settings.app.autoUpdate')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.app.autoUpdateDesc')}</p>
          </div>
          <Switch
            checked={autoUpdate}
            onChange={() => { void toggleAutoUpdate() }}
            disabled={updateSaving}
            noAnimation={!animate}
            hidden={!updateReady}
          />
        </div>
      </CardContent>
    </Card>
  )
}
