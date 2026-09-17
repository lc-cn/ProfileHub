'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { useToast } from '@/hooks/use-toast'

export function ConnectionDetails({ issuer, clientId, callbacks }: { issuer: string; clientId: string; callbacks: string[] }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const rows = [
    ['Issuer', issuer],
    [t('experience.discovery'), issuer ? `${issuer}/.well-known/openid-configuration` : ''],
    ['Client ID', clientId],
    [t('oauth2Clients.redirectUris'), callbacks.join('\n')],
  ]
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast({ title: t('oauth2Clients.copied') }) }
    catch { toast({ title: t('experience.copyFail'), variant: 'destructive' }) }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="connection-title">
    <h2 id="connection-title" className="text-lg font-semibold">{t('experience.connectionTitle')}</h2>
    <p className="text-sm text-muted-foreground">{t('experience.connectionHint')}</p>
    <dl className="space-y-4">{rows.map(([label, value]) => <div key={label}>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="mt-1 flex items-start gap-3"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-sm">{value || '—'}</code><Button size="sm" variant="outline" disabled={!value} onClick={() => void copy(value)} aria-label={`${t('experience.copy')} ${label}`}>{t('experience.copy')}</Button></dd>
    </div>)}</dl>
    <Link href="/docs/oauth2" className="inline-block text-sm underline">{t('experience.guide')}</Link>
  </section>
}
