'use client'

import { useState, type FormEvent } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/i18n/context'

export function InvitationAccept() {
  const { locale } = useI18n()
  const zh = locale === 'zh'
  const { data: session, update } = useSession()
  const router = useRouter()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function accept(event: FormEvent) {
    event.preventDefault()
    if (busy || !token.trim()) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) })
      const data = await response.json()
      if (!response.ok) {
        const errors: Record<string, [string, string]> = {
          email_mismatch: ['此邀请发给另一个邮箱，请使用受邀账号登录。', 'This invitation belongs to another email. Sign in with the invited account.'],
          already_member: ['你已经是该组织成员，请从顶部菜单切换组织。', 'You already belong to this organization. Switch to it from the organization menu.'],
          tenant_locked: ['该组织当前不可加入，请联系邀请人。', 'This organization is unavailable. Contact the inviter.'],
          not_found: ['当前部署未开启成员邀请。', 'Invitations are not enabled on this deployment.'],
        }
        throw new Error(errors[data.error]?.[zh ? 0 : 1] || (zh ? '邀请码无效、已过期或已被使用，请联系邀请人。' : 'The invitation is invalid, expired, or already used. Contact the inviter.'))
      }
      setToken('')
      await update({ currentTenantId: data.tenantId })
      router.push('/organizations/current'); router.refresh()
    } catch (error) { setError(error instanceof Error ? error.message : (zh ? '加入失败，请重试。' : 'Could not join. Try again.')) }
    finally { setBusy(false) }
  }
  return <form onSubmit={accept} className="space-y-4 rounded-xl border bg-card p-5">
    <h2 className="font-semibold">{zh ? '接受组织邀请' : 'Accept an organization invitation'}</h2>
    <p className="text-sm text-muted-foreground">{zh ? '粘贴管理员分享的邀请码。确认后使用当前账号加入组织，不会创建新账号。' : 'Paste the invitation code shared by an administrator. You will join with your current account; no new account is created.'}</p>
    <p className="break-all text-sm">{session?.user?.email}</p>
    <Label htmlFor="invitation-token">{zh ? '邀请码' : 'Invitation code'}</Label>
    <Input id="invitation-token" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" required />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !token.trim()}>{busy ? (zh ? '正在加入…' : 'Joining…') : (zh ? '确认加入组织' : 'Join organization')}</Button>
  </form>
}
