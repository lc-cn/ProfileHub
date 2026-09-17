'use client'

import { useCallback, useEffect, useState } from 'react'
import { getCsrfToken } from 'next-auth/react'
import { startRegistration } from '@simplewebauthn/browser'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'
import { broadcastMfaStatusUpdated } from '@/lib/mfa-status-broadcast'

type SecurityStatus = {
  hasPassword: boolean
  mfaEnabled: boolean
  hasTotp: boolean
  hasMfaPasskey: boolean
  passkeys: { id: string; label: string | null; canLogin: boolean; canMfa: boolean; createdAt: string }[]
}

export function ProfileSecurityCard(props: { hasPassword: boolean }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [csrf, setCsrf] = useState<string | null>(null)

  const [pkLabel, setPkLabel] = useState('')
  const [pkLogin, setPkLogin] = useState(true)
  const [pkMfa, setPkMfa] = useState(false)
  const [pkBusy, setPkBusy] = useState(false)

  const [totpPw, setTotpPw] = useState('')
  const [totpChallengeId, setTotpChallengeId] = useState<string | null>(null)
  const [totpOtpauth, setTotpOtpauth] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpBusy, setTotpBusy] = useState(false)

  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])

  const [mfaPw, setMfaPw] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const tok = await getCsrfToken()
      setCsrf(tok ?? null)
      const res = await fetch('/api/security/mfa/status')
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('profile.securityLoadFail'), variant: 'destructive' })
        return
      }
      const next = data as SecurityStatus
      setStatus(next)
      broadcastMfaStatusUpdated({ mfaEnabled: next.mfaEnabled })
    } catch {
      toast({ title: t('common.error'), description: t('profile.securityLoadFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  function showBackupCodes(codes: string[]) {
    setBackupCodes(codes)
    setBackupDialogOpen(true)
  }

  async function registerPasskey() {
    if (!csrf || !pkLogin && !pkMfa) {
      toast({ title: t('common.error'), description: t('login.errorGeneric'), variant: 'destructive' })
      return
    }
    setPkBusy(true)
    try {
      const optRes = await fetch('/api/webauthn/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: csrf,
          canLogin: pkLogin,
          canMfa: pkMfa,
          label: pkLabel,
        }),
      })
      const optData = await optRes.json()
      if (!optRes.ok) {
        toast({ title: t('common.error'), description: optData.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      const credential = (await startRegistration({ optionsJSON: optData.options })) as RegistrationResponseJSON
      const vRes = await fetch('/api/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: csrf,
          challengeId: optData.challengeId,
          credential,
        }),
      })
      const vData = await vRes.json()
      if (!vRes.ok) {
        toast({ title: t('common.error'), description: vData.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      toast({ title: t('common.success'), description: t('profile.profileUpdated') })
      await load()
    } catch {
      toast({ title: t('common.error'), description: t('login.errorGeneric'), variant: 'destructive' })
    } finally {
      setPkBusy(false)
    }
  }

  async function startTotp() {
    if (!csrf || !totpPw) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/security/mfa/totp/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrf, password: totpPw }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      setTotpChallengeId(data.challengeId)
      setTotpOtpauth(data.otpauthUrl)
      setTotpCode('')
      toast({ title: t('common.success'), description: t('profile.mfaEnableTotp') })
    } finally {
      setTotpBusy(false)
    }
  }

  async function confirmTotp() {
    if (!csrf || !totpChallengeId || !totpPw) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/security/mfa/totp/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csrfToken: csrf,
          password: totpPw,
          challengeId: totpChallengeId,
          totpCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      setTotpChallengeId(null)
      setTotpOtpauth(null)
      setTotpCode('')
      if (Array.isArray(data.backupCodes)) showBackupCodes(data.backupCodes as string[])
      await load()
    } finally {
      setTotpBusy(false)
    }
  }

  async function enablePasskeyMfa() {
    if (!csrf || !mfaPw) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/security/mfa/enable-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrf, password: mfaPw }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      if (Array.isArray(data.backupCodes)) showBackupCodes(data.backupCodes as string[])
      setMfaPw('')
      await load()
    } finally {
      setTotpBusy(false)
    }
  }

  async function disableMfa() {
    if (!csrf || !mfaPw) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/security/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrf, password: mfaPw }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      setMfaPw('')
      await load()
    } finally {
      setTotpBusy(false)
    }
  }

  async function rotateBackup() {
    if (!csrf || !mfaPw) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/security/mfa/backup/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrfToken: csrf, password: mfaPw }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
        return
      }
      if (Array.isArray(data.backupCodes)) showBackupCodes(data.backupCodes as string[])
    } finally {
      setTotpBusy(false)
    }
  }

  async function deletePasskey(id: string) {
    if (!csrf) return
    const res = await fetch(`/api/webauthn/credentials/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csrfToken: csrf }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: t('common.error'), description: data.error ?? t('login.errorGeneric'), variant: 'destructive' })
      return
    }
    await load()
  }

  if (loading || !status) {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{t('profile.sectionSecurity')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('experience.securityHint')}</p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">{t('profile.sectionSecurity')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('experience.securityHint')}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {status.mfaEnabled ? t('profile.mfaOn') : t('profile.mfaOff')}
            {!props.hasPassword ? ` ${t('profile.mfaNeedPassword')}` : null}
          </p>

            <div className="space-y-3 rounded-xl border border-border/60 p-4">
              <p className="text-sm font-medium">{t('profile.passkeyRegister')}</p>
              <div className="app-form-field">
                <Label htmlFor="pk-label">{t('profile.passkeyLabel')}</Label>
                <Input id="pk-label" className="w-full" value={pkLabel} onChange={(e) => setPkLabel(e.target.value)} />
              </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pk-login" checked={pkLogin} onCheckedChange={(c) => setPkLogin(c === true)} />
              <Label htmlFor="pk-login" className="font-normal">
                {t('profile.canLogin')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pk-mfa" checked={pkMfa} onCheckedChange={(c) => setPkMfa(c === true)} />
              <Label htmlFor="pk-mfa" className="font-normal">
                {t('profile.canMfa')}
              </Label>
            </div>
            <Button type="button" disabled={pkBusy || !props.hasPassword} onClick={() => void registerPasskey()}>
              {t('profile.passkeySave')}
            </Button>
          </div>

          {status.passkeys.length ? (
            <ul className="space-y-2 text-sm">
              {status.passkeys.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2">
                  <span>
                    {p.label || 'Passkey'} · {p.canLogin ? t('profile.canLogin') : ''}
                    {p.canLogin && p.canMfa ? ' · ' : ''}
                    {p.canMfa ? t('profile.canMfa') : ''}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void deletePasskey(p.id)}>
                    {t('common.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {props.hasPassword && !status.mfaEnabled ? (
              <div className="space-y-4 rounded-xl border border-border/60 p-4">
              <p className="text-sm font-medium">{t('profile.mfaEnableTotp')}</p>
              <div className="app-form-field">
                <Label htmlFor="totp-pw">{t('profile.confirmPassword')}</Label>
                <Input
                  id="totp-pw"
                  type="password"
                  className="w-full"
                  value={totpPw}
                  onChange={(e) => setTotpPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {!totpOtpauth ? (
                <Button type="button" variant="secondary" disabled={totpBusy || !totpPw} onClick={() => void startTotp()}>
                  {totpBusy ? t('common.loading') : t('profile.totpPrepare')}
                </Button>
              ) : null}
              {totpOtpauth ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('experience.totpHint')}</p>
                  <p className="break-all rounded border p-3 font-mono text-xs">{totpOtpauth}</p>
                  <div className="app-form-field">
                    <Label htmlFor="totp-code">{t('mfa.totpLabel')}</Label>
                    <Input id="totp-code" className="w-full" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
                  </div>
                  <Button type="button" disabled={totpBusy} onClick={() => void confirmTotp()}>
                    {totpBusy ? t('common.loading') : t('profile.totpConfirm')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {props.hasPassword && !status.mfaEnabled && status.passkeys.some((p) => p.canMfa) ? (
            <div className="space-y-3 rounded-xl border border-border/60 p-4">
              <p className="text-sm font-medium">{t('profile.mfaEnablePasskey')}</p>
              <div className="app-form-field">
                <Label htmlFor="mfa-pw-passkey">{t('profile.confirmPassword')}</Label>
                <Input
                  id="mfa-pw-passkey"
                  type="password"
                  className="w-full"
                  value={mfaPw}
                  onChange={(e) => setMfaPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button type="button" variant="secondary" disabled={totpBusy} onClick={() => void enablePasskeyMfa()}>
                {t('profile.mfaEnablePasskey')}
              </Button>
            </div>
          ) : null}

          {props.hasPassword && status.mfaEnabled ? (
            <div className="space-y-3">
              <div className="app-form-field">
                <Label htmlFor="mfa-rotate-pw">{t('profile.confirmPassword')}</Label>
                <Input
                  id="mfa-rotate-pw"
                  type="password"
                  className="w-full"
                  value={mfaPw}
                  onChange={(e) => setMfaPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={totpBusy} onClick={() => void rotateBackup()}>
                  {t('profile.mfaBackupRotate')}
                </Button>
                <Button type="button" variant="destructive" disabled={totpBusy} onClick={() => void disableMfa()}>
                  {t('profile.mfaDisable')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profile.backupCodesTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className="list-inside list-decimal font-mono text-sm text-foreground">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('profile.close')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => setBackupDialogOpen(false)}>{t('profile.close')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
