'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { SIDEBAR_NAV_ACCESS, sidebarTenantLinkVisible } from '@/lib/tenant-dashboard-nav-permissions'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { useI18n } from '@/i18n/context'
import { Users, Shield, Key, AppWindow, type LucideIcon } from 'lucide-react'

type Stat = {
  titleKey: string
  value: number
  icon: LucideIcon
}

export function DashboardView({
  tenantName,
  tenantSlug,
  userCount,
  roleCount,
  permissionCount,
  appCount,
}: {
  tenantName: string
  tenantSlug: string
  userCount: number
  roleCount: number
  permissionCount: number
  appCount: number
}) {
  const { t } = useI18n()
  const { data: session } = useSession()
  const tasks = [
    { href: '/applications', key: 'nextApps' },
    { href: '/users', key: 'nextMembers' },
    { href: '/roles', key: 'nextRoles' },
    { href: '/profile?tab=security', key: 'nextSecurity' },
  ].filter(task => {
    const row = SIDEBAR_NAV_ACCESS.find(row => row.href === task.href.split('?')[0])
    return row && sidebarTenantLinkVisible(row, session)
  })

  const stats: Stat[] = [
    { titleKey: 'dashboard.statUsers', value: userCount, icon: Users },
    { titleKey: 'dashboard.statRoles', value: roleCount, icon: Shield },
    { titleKey: 'dashboard.statPermissions', value: permissionCount, icon: Key },
    { titleKey: 'dashboard.statApps', value: appCount, icon: AppWindow },
  ]

  return (
    <PageShell density="comfortable">
      <PageHeader
        title={t('dashboard.title')}
        description={
          tenantName ? (
            <div className="space-y-1">
              <p className="app-page-desc">{t('dashboard.subtitle')}</p>
              <p className="text-sm font-medium text-foreground">
                {t('dashboard.contextLine', { name: tenantName, slug: tenantSlug })}
              </p>
            </div>
          ) : (
            t('dashboard.subtitle')
          )
        }
      />

      <section aria-labelledby="next-actions" className="space-y-4">
        <h2 id="next-actions" className="text-lg font-semibold">{t('experience.nextTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {tasks.map(task => <Link key={task.href} href={task.href} className="rounded-xl border bg-card p-5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
            <h3 className="font-medium">{t(`experience.${task.key}`)}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t(`experience.${task.key}Desc`)}</p>
          </Link>)}
        </div>
      </section>
      <div className="app-grid-stats">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div
              key={stat.titleKey}
              className="relative overflow-hidden rounded-2xl border border-border/40 bg-card p-5 pl-5 shadow-card ring-1 ring-black/[0.03] sm:p-6 sm:pl-6"
            >
              <div
                className="pointer-events-none absolute bottom-4 left-0 top-4 w-1 rounded-full bg-foreground/25"
                aria-hidden
              />
              <div className="relative flex items-start justify-between gap-3 pl-3">
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{t(stat.titleKey)}</p>
                  <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums sm:text-4xl">
                    {stat.value}
                  </p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </PageShell>
  )
}
