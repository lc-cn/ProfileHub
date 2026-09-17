'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { CreateOrganizationForm } from '@/components/tenant/create-organization-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageShell } from '@/components/layout/page-shell'
import { useI18n } from '@/i18n/context'

/** 已登录但未加入任何租户（且非平台管理员）时的引导页 */
export default function NoTenantPage() {
  const { data: session } = useSession()
  const { t } = useI18n()

  return (
    <PageShell mainVariant="narrow">
      <div className="flex min-h-[60vh] flex-col justify-center gap-6 py-4">
        <Card className="w-full border-border/60 shadow-card">
          <CardHeader>
            <CardTitle>{t('noTenant.title')}</CardTitle>
            <CardDescription className="text-base leading-relaxed">
              {t('noTenant.description')}
              {session?.user?.email ? (
                <span className="mt-2 block font-mono text-xs text-foreground/80">{session.user.email}</span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                <p className="text-sm font-semibold text-foreground">{t('noTenant.stepInviteTitle')}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('noTenant.stepInviteBody')}</p>
                <Button asChild variant="outline" className="mt-3"><Link href="/invitations">{t('noTenant.stepInviteTitle')}</Link></Button>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                <p className="text-sm font-semibold text-foreground">{t('noTenant.stepSelfTitle')}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('noTenant.stepSelfBody')}</p>
              </div>
            </div>

            <div className="space-y-4 border-t border-border/50 pt-6">
              <CreateOrganizationForm />
            </div>

            <div className="flex flex-col gap-2 border-t border-border/50 pt-4 sm:flex-row sm:gap-3">
              <Button variant="outline" asChild>
                <Link href="/login">{t('noTenant.reopenLogin')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
