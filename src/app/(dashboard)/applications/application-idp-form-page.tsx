'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { ConnectionDetails } from '@/components/oauth/connection-details'
import { useManagementAccess } from '@/components/tenant/management-access'
import { PermissionCodes } from '@/lib/permission-codes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'
import { PageShell } from '@/components/layout/page-shell'
import { cn } from '@/lib/utils'
import {
  defaultFormState,
  formStateFromDto,
  scopesFromForm,
  type OAuth2ClientDto,
  type OAuth2ClientFormState,
} from './oauth-idp-types'

const SECRET_FLASH_KEY = 'oauth2_client_secret_flash'

const SECTION_IDS = {
  basic: 'idp-sec-basic',
  branding: 'idp-sec-branding',
  callbacks: 'idp-sec-callbacks',
  security: 'idp-sec-security',
} as const

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-6 border-b border-border/70 pb-10 last:border-b-0 last:pb-0">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-6">{children}</div>
    </section>
  )
}

function FieldHint({ text }: { text: string }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
}

function RequiredFieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-semibold text-foreground">
      {children}
      <span className="ml-0.5 font-semibold text-red-600 dark:text-red-400" aria-hidden>
        *
      </span>
    </Label>
  )
}

export function ApplicationIdpFormPage({
  applicationId,
  issuer,
  applicationName,
  mode,
  initialRow,
}: {
  applicationId: string
  issuer: string
  applicationName: string
  mode: 'create' | 'edit'
  initialRow?: OAuth2ClientDto | null
}) {
  const { t } = useI18n()
  const access = useManagementAccess()
  const canWrite = access.can(PermissionCodes.OAUTH_CLIENT_WRITE)
  const { toast } = useToast()
  const router = useRouter()
  const [form, setForm] = useState<OAuth2ClientFormState>(() =>
    mode === 'edit' && initialRow
      ? formStateFromDto(initialRow)
      : { ...defaultFormState(), name: applicationName }
  )
  const [flashSecret, setFlashSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const navItems = useMemo(
    () => [
      { id: SECTION_IDS.basic, label: t('oauth2Clients.sectionBasic') },
      { id: SECTION_IDS.branding, label: t('oauth2Clients.sectionBranding') },
      { id: SECTION_IDS.callbacks, label: t('oauth2Clients.sectionCallbacks') },
      { id: SECTION_IDS.security, label: t('oauth2Clients.sectionSecurity') },
    ],
    [t]
  )

  const pageTitle =
    mode === 'edit' && initialRow ? initialRow.name : t('applications.idpCreateTitle')

  useEffect(() => {
    if (mode !== 'edit' || !initialRow?.id) return
    try {
      const raw = sessionStorage.getItem(SECRET_FLASH_KEY)
      if (!raw) return
      const o = JSON.parse(raw) as { id?: string; secret?: string }
      if (o.id === initialRow.id && typeof o.secret === 'string' && o.secret) {
        setFlashSecret(o.secret)
      }
    } catch {
      /* ignore */
    } finally {
      sessionStorage.removeItem(SECRET_FLASH_KEY)
    }
  }, [mode, initialRow?.id])

  const buildPayload = () => {
    const redirectUris = form.redirectLines
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const postLogoutRedirectUris = form.postLogoutLines
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const allowedScopes = scopesFromForm(form)
    return {
      name: form.name,
      clientId: form.clientId.trim() || undefined,
      redirectUris,
      postLogoutRedirectUris,
      allowedScopes,
      confidential: form.confidential,
      clientSecret: form.confidential && form.clientSecret.trim() ? form.clientSecret.trim() : undefined,
      regenerateSecret: form.regenerateSecret,
      logoUrl: form.logoUrl.trim() || null,
      clientUri: form.clientUri.trim() || null,
      policyUri: form.policyUri.trim() || null,
      tosUri: form.tosUri.trim() || null,
      jwksUri: form.jwksUri.trim() || null,
      grantRefreshToken: form.grantRefreshToken,
      accessTokenTtlSeconds: form.accessTokenTtlSeconds,
      refreshTokenTtlDays: form.refreshTokenTtlDays,
      authorizationCodeTtlMinutes: form.authorizationCodeTtlMinutes,
    }
  }

  const handleSubmit = async () => {
    if (!canWrite || busy) return
    if (form.scopeOffline && !form.grantRefreshToken) {
      toast({
        title: t('common.error'),
        description: t('oauth2Clients.errOfflineNeedsRefresh'),
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    try {
      const base = buildPayload()
      if (mode === 'edit' && initialRow) {
        const res = await fetch(`/api/applications/${applicationId}/oauth`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...base,
            clientSecret: form.clientSecret.trim() || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'fail')
        toast({ title: t('common.success'), description: t('oauth2Clients.updated') })
        if (data.clientSecret) {
          setFlashSecret(String(data.clientSecret))
          setForm((p) => ({ ...p, clientSecret: '', regenerateSecret: false }))
        } else {
          router.refresh()
        }
      } else {
        const res = await fetch(`/api/applications/${applicationId}/oauth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(base),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'fail')
        toast({ title: t('common.success'), description: t('oauth2Clients.created') })
        const secret = data.clientSecret ? String(data.clientSecret) : null
        if (secret) {
          sessionStorage.setItem(SECRET_FLASH_KEY, JSON.stringify({ id: applicationId, secret }))
          router.replace(`/applications/${applicationId}/idp`)
        } else {
          router.replace(`/applications/${applicationId}/idp`)
          router.refresh()
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      toast({ title: t('common.error'), description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const showSecretBanner = Boolean(flashSecret)
  const logoPreviewUrl = form.logoUrl.trim()
  const showLogoPreview = /^https:\/\//i.test(logoPreviewUrl)

  return (
    <PageShell mainVariant="narrow" className="max-w-5xl">
      {initialRow && <ConnectionDetails issuer={issuer} clientId={initialRow.clientId} callbacks={initialRow.redirectUris} />}
      {!canWrite && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{t('experience.readOnly')}</p>}
      <div className="flex flex-col gap-6 border-b border-border/80 pb-8 sm:flex-row sm:items-start sm:justify-between sm:pb-10">
        <div className="min-w-0 space-y-3">
          <nav
            className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
            aria-label="Breadcrumb"
          >
            <Link href="/applications" className="hover:text-foreground">
              {t('applications.title')}
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
            <span className="truncate font-medium text-foreground">{applicationName}</span>
            <ChevronRight className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
            <span className="font-medium text-foreground">{t('applications.colOidc')}</span>
          </nav>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
              {pageTitle}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
              {t('applications.idpSubtitle')}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full shrink-0 sm:mt-1 sm:w-auto">
          <Link href="/applications">{t('applications.idpBackToList')}</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <aside className="shrink-0 lg:sticky lg:top-24 lg:w-44">
          <p className="mb-2 hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">
            {t('oauth2Clients.navSections')}
          </p>
          <div className="flex flex-wrap gap-2 border-b border-border/60 pb-4 lg:flex-col lg:gap-0.5 lg:border-0 lg:pb-0">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors',
                  'hover:bg-muted/80 hover:text-foreground',
                  'lg:w-full lg:rounded-md lg:py-1.5'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        <Card className="min-w-0 flex-1 overflow-hidden shadow-sm">
          <CardContent className="space-y-10 px-5 pb-2 pt-6 sm:px-8 sm:pt-8">
            {showSecretBanner ? (
              <div className="rounded-xl border border-amber-500/45 bg-amber-500/[0.12] p-4 text-sm shadow-sm">
                <p className="font-medium text-foreground">{t('oauth2Clients.secretOnce')}</p>
                <p className="mt-2 break-all font-mono text-xs leading-relaxed">{flashSecret}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (flashSecret) void navigator.clipboard.writeText(flashSecret)
                      toast({ title: t('common.success'), description: t('oauth2Clients.copied') })
                    }}
                  >
                    {t('oauth2Clients.copySecret')}
                  </Button>
                  <Button type="button" size="sm" onClick={() => setFlashSecret(null)}>
                    {t('oauth2Clients.savedSecretContinue')}
                  </Button>
                </div>
              </div>
            ) : null}

            <fieldset disabled={!canWrite || busy} className="space-y-10">
            <Section id={SECTION_IDS.basic} title={t('oauth2Clients.sectionBasic')}>
              <div className="app-form-field">
                <RequiredFieldLabel htmlFor="idp-name">{t('oauth2Clients.colName')}</RequiredFieldLabel>
                <Input
                  id="idp-name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
                <FieldHint text={t('oauth2Clients.hintName')} />
              </div>
              <div className="app-form-field">
                <Label htmlFor="idp-client-id" className="text-sm font-semibold text-foreground">
                  {t('oauth2Clients.colClientId')}
                </Label>
                {mode === 'edit' ? (
                  <div className="rounded-xl border border-border/70 bg-muted/30 px-1 py-1 shadow-inner">
                    <Input
                      id="idp-client-id"
                      value={form.clientId}
                      onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
                      disabled
                      className="border-0 bg-transparent font-mono text-sm shadow-none focus-visible:ring-0"
                    />
                  </div>
                ) : (
                  <Input
                    id="idp-client-id"
                    value={form.clientId}
                    onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
                    placeholder={t('oauth2Clients.clientIdPlaceholder')}
                    className="font-mono text-sm"
                  />
                )}
                <FieldHint text={t('oauth2Clients.hintClientId')} />
              </div>
            </Section>

            <Section id={SECTION_IDS.branding} title={t('oauth2Clients.sectionBranding')}>
              <div className="app-form-field">
                <Label htmlFor="oauth-logoUrl" className="text-sm font-semibold text-foreground">{t('oauth2Clients.logoUrl')}</Label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {showLogoPreview ? (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/80 bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoPreviewUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        onError={(e) => {
                          e.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <Input
                      id="oauth-logoUrl" value={form.logoUrl}
                      onChange={(e) => setForm((p) => ({ ...p, logoUrl: e.target.value }))}
                      placeholder="https://"
                    />
                    <FieldHint text={t('oauth2Clients.hintLogo')} />
                  </div>
                </div>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="app-form-field">
                  <Label htmlFor="oauth-clientUri" className="text-sm font-semibold text-foreground">{t('oauth2Clients.clientUri')}</Label>
                  <Input
                    id="oauth-clientUri" value={form.clientUri}
                    onChange={(e) => setForm((p) => ({ ...p, clientUri: e.target.value }))}
                    placeholder="https://"
                  />
                </div>
                <div className="app-form-field">
                  <Label htmlFor="oauth-policyUri" className="text-sm font-semibold text-foreground">{t('oauth2Clients.policyUri')}</Label>
                  <Input
                    id="oauth-policyUri" value={form.policyUri}
                    onChange={(e) => setForm((p) => ({ ...p, policyUri: e.target.value }))}
                    placeholder="https://"
                  />
                </div>
                <div className="app-form-field sm:col-span-2">
                  <Label htmlFor="oauth-tosUri" className="text-sm font-semibold text-foreground">{t('oauth2Clients.tosUri')}</Label>
                  <Input
                    id="oauth-tosUri" value={form.tosUri}
                    onChange={(e) => setForm((p) => ({ ...p, tosUri: e.target.value }))}
                    placeholder="https://"
                  />
                </div>
              </div>
            </Section>

            <Section id={SECTION_IDS.callbacks} title={t('oauth2Clients.sectionCallbacks')}>
              <div className="app-form-field">
                <RequiredFieldLabel htmlFor="idp-redirect">{t('oauth2Clients.redirectUris')}</RequiredFieldLabel>
                <Textarea
                  id="idp-redirect"
                  value={form.redirectLines}
                  onChange={(e) => setForm((p) => ({ ...p, redirectLines: e.target.value }))}
                  rows={5}
                  className="min-h-[120px] resize-y font-mono text-xs leading-relaxed"
                  placeholder="https://app.example.com/oauth/callback"
                />
                <FieldHint text={t('oauth2Clients.hintRedirect')} />
              </div>
              <div className="app-form-field">
                <Label htmlFor="idp-post-logout" className="text-sm font-semibold text-foreground">
                  {t('oauth2Clients.postLogoutUris')}
                </Label>
                <Textarea
                  id="idp-post-logout"
                  value={form.postLogoutLines}
                  onChange={(e) => setForm((p) => ({ ...p, postLogoutLines: e.target.value }))}
                  rows={4}
                  className="resize-y font-mono text-xs leading-relaxed"
                  placeholder="https://app.example.com/"
                />
                <FieldHint text={t('oauth2Clients.hintPostLogout')} />
              </div>
            </Section>

            <Section id={SECTION_IDS.security} title={t('oauth2Clients.sectionSecurity')}>
              <div className="flex gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3">
                <Checkbox
                  id="grantRef"
                  className="mt-0.5"
                  checked={form.grantRefreshToken}
                  onCheckedChange={(v) =>
                    setForm((p) => ({
                      ...p,
                      grantRefreshToken: !!v,
                      scopeOffline: !!v ? p.scopeOffline : false,
                    }))
                  }
                />
                <div className="min-w-0">
                  <Label htmlFor="grantRef" className="cursor-pointer text-sm font-semibold leading-snug">
                    {t('oauth2Clients.grantRefresh')}
                  </Label>
                  <FieldHint text={t('oauth2Clients.hintGrantRefresh')} />
                </div>
              </div>
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-foreground">{t('oauth2Clients.hintScopes')}</Label>
                <div className="flex flex-wrap gap-x-5 gap-y-3 rounded-xl border border-border/70 bg-card px-4 py-3.5">
                  <div className="flex items-center gap-2.5 opacity-80">
                    <Checkbox id="scOidc" checked disabled />
                    <Label htmlFor="scOidc" className="cursor-default text-sm font-normal">
                      {t('oauth2Clients.scopeOpenid')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="scProf"
                      checked={form.scopeProfile}
                      onCheckedChange={(v) => setForm((p) => ({ ...p, scopeProfile: !!v }))}
                    />
                    <Label htmlFor="scProf" className="cursor-pointer text-sm font-normal">
                      {t('oauth2Clients.scopeProfile')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="scMail"
                      checked={form.scopeEmail}
                      onCheckedChange={(v) => setForm((p) => ({ ...p, scopeEmail: !!v }))}
                    />
                    <Label htmlFor="scMail" className="cursor-pointer text-sm font-normal">
                      {t('oauth2Clients.scopeEmail')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="scOff"
                      checked={form.scopeOffline}
                      disabled={!form.grantRefreshToken}
                      onCheckedChange={(v) => {
                        const on = !!v
                        setForm((p) => ({
                          ...p,
                          scopeOffline: on,
                          grantRefreshToken: on ? true : p.grantRefreshToken,
                        }))
                      }}
                    />
                    <Label
                      htmlFor="scOff"
                      className={cn(
                        'cursor-pointer text-sm font-normal',
                        !form.grantRefreshToken && 'text-muted-foreground'
                      )}
                    >
                      {t('oauth2Clients.scopeOffline')}
                    </Label>
                  </div>
                </div>
              </div>
              <details className="space-y-4 rounded-lg border p-4">
                <summary className="cursor-pointer text-sm font-medium">{t('oauth2Clients.sectionAdvanced')}</summary>
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="app-form-field">
                  <Label htmlFor="oauth-accessTokenTtlSeconds" className="text-sm font-semibold text-foreground">{t('oauth2Clients.accessTokenTtl')}</Label>
                  <Input
                    id="oauth-accessTokenTtlSeconds" type="number"
                    min={300}
                    max={86400}
                    value={form.accessTokenTtlSeconds}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, accessTokenTtlSeconds: Number(e.target.value) || 3600 }))
                    }
                  />
                  <FieldHint text={t('oauth2Clients.hintAccessTtl')} />
                </div>
                <div className="app-form-field">
                  <Label htmlFor="oauth-refreshTokenTtlDays" className="text-sm font-semibold text-foreground">{t('oauth2Clients.refreshTokenTtl')}</Label>
                  <Input
                    id="oauth-refreshTokenTtlDays" type="number"
                    min={1}
                    max={365}
                    value={form.refreshTokenTtlDays}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, refreshTokenTtlDays: Number(e.target.value) || 30 }))
                    }
                  />
                  <FieldHint text={t('oauth2Clients.hintRefreshTtl')} />
                </div>
                <div className="app-form-field sm:col-span-1">
                  <Label htmlFor="oauth-authorizationCodeTtlMinutes" className="text-sm font-semibold text-foreground">{t('oauth2Clients.authCodeTtl')}</Label>
                  <Input
                    id="oauth-authorizationCodeTtlMinutes" type="number"
                    min={1}
                    max={60}
                    value={form.authorizationCodeTtlMinutes}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        authorizationCodeTtlMinutes: Number(e.target.value) || 10,
                      }))
                    }
                  />
                  <FieldHint text={t('oauth2Clients.hintCodeTtl')} />
                </div>
              </div>
              </details>
              <div className="flex gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
                <Checkbox
                  id="oauthConf"
                  className="mt-0.5"
                  checked={form.confidential}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, confidential: !!v }))}
                />
                <Label htmlFor="oauthConf" className="cursor-pointer text-sm font-semibold leading-snug">
                  {t('oauth2Clients.confidential')}
                </Label>
              </div>
              {form.confidential && mode === 'create' ? (
                <div className="app-form-field">
                  <Label className="text-sm font-semibold text-foreground">{t('oauth2Clients.optionalSecret')}</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={form.clientSecret}
                    onChange={(e) => setForm((p) => ({ ...p, clientSecret: e.target.value }))}
                    placeholder={t('oauth2Clients.secretPlaceholder')}
                  />
                </div>
              ) : null}
              {form.confidential && mode === 'edit' ? (
                <>
                  <div className="app-form-field">
                    <Label className="text-sm font-semibold text-foreground">
                      {t('oauth2Clients.newSecretOptional')}
                    </Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={form.clientSecret}
                      onChange={(e) => setForm((p) => ({ ...p, clientSecret: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-3 rounded-xl border border-dashed border-border/80 bg-muted/15 px-4 py-3">
                    <Checkbox
                      id="oauthRegen"
                      className="mt-0.5"
                      checked={form.regenerateSecret}
                      onCheckedChange={(v) => setForm((p) => ({ ...p, regenerateSecret: !!v }))}
                    />
                    <Label htmlFor="oauthRegen" className="cursor-pointer text-sm font-medium leading-snug">
                      {t('oauth2Clients.regenerateSecret')}
                    </Label>
                  </div>
                </>
              ) : null}
            </Section>


            </fieldset>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 bg-muted/15 px-5 py-4 sm:px-8">
            <Button type="button" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => router.push('/applications')}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!canWrite || busy || showSecretBanner}
              onClick={() => void handleSubmit()}
              className="min-w-[7.5rem] bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {t('common.save')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PageShell>
  )
}
