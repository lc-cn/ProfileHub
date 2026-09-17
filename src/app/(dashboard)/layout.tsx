import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { ManagementAccessProvider } from '@/components/tenant/management-access'
import { enforceTenantRbac } from '@/lib/rbac-env'
import { AppShell } from '@/components/layout/app-shell'

/** 管理后台：侧栏 + 顶栏；与 `(docs)`、`/login` 等互不嵌套 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2F')
  }
  if (session.mfaPending) {
    redirect('/mfa')
  }
  return <ManagementAccessProvider enforce={enforceTenantRbac()}><AppShell>{children}</AppShell></ManagementAccessProvider>
}
