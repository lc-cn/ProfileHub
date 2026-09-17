'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n/context'
import { Button } from '@/components/ui/button'
import {
  Users,
  Shield,
  Key,
  AppWindow,
  Layers,
  Settings,
  LayoutDashboard,
  CircleUser,
  Building2,
  Landmark,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import {
  SIDEBAR_NAV_ACCESS,
  sidebarTenantLinkVisible,
  type SidebarNavAccessRow,
} from '@/lib/tenant-dashboard-nav-permissions'

const iconByHref: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/organizations/current': Landmark,
  '/profile': CircleUser,
  '/users': Users,
  '/roles': Shield,
  '/permissions': Key,
  '/applications': AppWindow,
  '/features': Layers,
  '/system-config': Settings,
}

type SidebarNavProps = {
  /** 点击导航链接后回调（用于关闭移动端抽屉） */
  onLinkClick?: () => void
  showCloseButton?: boolean
  onClose?: () => void
  /** 桌面侧栏收起：仅图标 + 缩短品牌区 */
  collapsed?: boolean
  /** 桌面端展开/收起（移动端不传） */
  onToggleCollapse?: () => void
}

export function SidebarNav({
  onLinkClick,
  showCloseButton,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: SidebarNavProps) {
  const pathname = usePathname()
  const { t } = useI18n()
  const { data: session } = useSession()

  const platformItem =
    session?.isPlatformAdmin === true
      ? [{ href: '/platform', labelKey: 'nav.platform' as const, icon: Building2 } as const]
      : []

  const tenantNav = SIDEBAR_NAV_ACCESS.filter((row: SidebarNavAccessRow) =>
    sidebarTenantLinkVisible(row, session)
  ).map((row: SidebarNavAccessRow) => ({
    href: row.href,
    labelKey: row.labelKey,
    icon: iconByHref[row.href] ?? LayoutDashboard,
  }))

  const groups = [
    { label: 'experience.groupOrg', paths: ['/', '/organizations/current', '/users'] },
    { label: 'experience.groupApps', paths: ['/applications', '/features', '/permissions', '/roles'] },
    { label: 'experience.groupAccount', paths: ['/profile'] },
    { label: 'experience.groupPlatform', paths: ['/platform', '/system-config'] },
  ]
  const items = [...tenantNav, ...platformItem]
  const allNav = groups.flatMap(group => group.paths.flatMap(href => {
    const item = items.find(item => item.href === href)
    return item ? [{ ...item, group: group.label }] : []
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={cn(
          'relative shrink-0 border-b border-border/40 px-3 pb-4 pt-3 sm:px-4 sm:pb-5 sm:pt-4',
          showCloseButton && 'pr-14',
          collapsed && 'px-2 pb-3 pt-3 sm:px-2 sm:pb-4 sm:pt-3'
        )}
      >
        {showCloseButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-3 h-9 w-9 shrink-0"
            onClick={onClose}
            aria-label={t('common.closeMenu')}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
        <div
          className={cn(
            'rounded-2xl border border-indigo-200/35 bg-gradient-to-br from-card to-indigo-50/[0.35] shadow-sm ring-1 ring-indigo-950/[0.03] dark:border-indigo-500/10 dark:from-muted/50 dark:to-violet-950/20 dark:ring-white/5',
            collapsed ? 'flex items-center justify-center px-0 py-3' : 'px-4 py-4'
          )}
          aria-label={collapsed ? t('nav.brand') : undefined}
        >
          {collapsed ? (
            <LayoutDashboard className="h-6 w-6 shrink-0 text-foreground" aria-hidden />
          ) : (
            <>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-foreground sm:text-xl">{t('nav.brand')}</h1>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{t('nav.tagline')}</p>
            </>
          )}
        </div>
      </div>
      <nav
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-2 py-3 sm:px-3 sm:py-4',
          collapsed && 'px-1.5 sm:px-1.5'
        )}
      >
        <ul className="space-y-1">
          {allNav.map((item, index) => {
            const Icon = item.icon
            const isActive =
              pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
            const label = t(item.labelKey)
            return (
              <li key={item.href}>
                {!collapsed && (index === 0 || allNav[index - 1].group !== item.group) && (
                  <p className="px-3 pb-2 pt-4 text-xs font-medium text-muted-foreground">{t(item.group)}</p>
                )}
                <Link
                  href={item.href}
                  onClick={() => onLinkClick?.()}
                  aria-label={label}
                  title={collapsed ? label : undefined}
                  className={cn(
                    'flex cursor-pointer items-center rounded-xl border border-transparent text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
                    isActive
                      ? 'border-primary/25 bg-gradient-to-r from-primary/[0.08] to-primary/[0.02] font-semibold text-foreground shadow-sm ring-1 ring-primary/10'
                      : 'text-muted-foreground hover:border-primary/15 hover:bg-muted/80 hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                  <span className={cn('min-w-0 break-words', collapsed && 'sr-only')}>{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className={cn('shrink-0 border-t border-border/40 px-2 py-2', collapsed && 'px-1')}>
        {onToggleCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mx-auto mb-1 flex h-9 w-9"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            aria-pressed={collapsed}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        ) : null}
        <p className={cn('text-center text-xs text-muted-foreground', collapsed && 'text-[0.65rem] leading-tight')}>
          {collapsed ? 'PH' : 'ProfileHub'}
        </p>
      </div>
    </div>
  )
}
