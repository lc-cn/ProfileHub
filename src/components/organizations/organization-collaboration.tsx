'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/i18n/context'

type Invitation = { id: string; emailConstraint: string | null; consumedAt: string | null; expiresAt: string }
type Transfer = { id: string; toUserId: string; status: string; expiresAt: string; recipientName: string; recipientEmail: string }
type Member = { userId: string; displayName: string; email: string; tenantRole: string }

export function OrganizationCollaboration({ tenantId, invites, canReadInvites, canInvite, transfers, owner, userId }: {
  tenantId: string; invites: boolean; canReadInvites: boolean; canInvite: boolean; transfers: boolean; owner: boolean; userId: string
}) {
  const { locale } = useI18n()
  const zh = locale === 'zh'
  const { update } = useSession()
  const router = useRouter()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [requests, setRequests] = useState<Transfer[]>([])
  const [email, setEmail] = useState('')
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null)
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [target, setTarget] = useState('')
  const [now, setNow] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const base = `/api/tenants/${tenantId}`
  const load = useCallback(async () => {
    const get = async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(zh ? '无法加载协作记录，请重试或检查权限。' : 'Could not load collaboration records. Retry or check permissions.')
      return response.json()
    }
    if (invites && canReadInvites) setInvitations((await get(`${base}/invitations`)).invitations)
    if (transfers) setRequests((await get(`${base}/owner-transfer`)).requests)
  }, [base, invites, canReadInvites, transfers, zh])
  useEffect(() => {
    queueMicrotask(() => { setNow(Date.now()); void load().catch(error => setError(error.message)) })
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [load])
  async function mutate(path: string, body: object, success: (data: Record<string, string>) => Promise<void> | void) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(zh ? '操作未完成。请确认组织、成员身份和请求有效期，然后重试。' : 'The action did not complete. Check the organization, member role, and request expiry before retrying.')
      await success(data)
      await load()
    } catch (error) { setError(error instanceof Error ? error.message : (zh ? '网络错误，请重试。' : 'Network error. Try again.')) }
    finally { setBusy(false) }
  }
  async function search(event: FormEvent) {
    event.preventDefault(); setTarget(''); setError('')
    try {
      const response = await fetch(`/api/organizations/current/members?q=${encodeURIComponent(query)}`)
      if (!response.ok) throw new Error(zh ? '查找成员失败' : 'Could not find members')
      setMembers((await response.json()).items.filter((member: Member) => member.tenantRole !== 'owner'))
    } catch (error) { setError(error instanceof Error ? error.message : 'Error') }
  }
  const formatDate = (value: string) => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  const expired = (value: string) => new Date(value).getTime() <= now
  return <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={() => void load().then(() => setError('')).catch(error => setError(error.message))}>{zh ? '重新加载' : 'Reload'}</Button></p>}
    {notice && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{notice}</p>}
    {invites && <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{zh ? '邀请成员' : 'Member invitations'}</h2>
      <p className="text-sm text-muted-foreground">{zh ? '邀请码有效期为 7 天，只能使用一次。将邀请码分享给指定邮箱的已有账号；系统不会自动发送邮件。' : 'Codes expire in 7 days and can be used once. Share a code with an existing account at the specified email; no email is sent automatically.'}</p>
      {canInvite && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate('invitations', { email: email.trim(), expiresInDays: 7 }, data => { setIssued({ token: data.token, expiresAt: data.expiresAt }); setEmail('') }) }}>
        <Label htmlFor="invite-email">{zh ? '受邀邮箱' : 'Invited email'}</Label>
        <Input id="invite-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        <Button disabled={busy || !email.trim()}>{zh ? '生成邀请码' : 'Create invitation code'}</Button>
      </form>}
      {issued && <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm">{zh ? '请现在复制，关闭或刷新后无法再次查看。到期时间：' : 'Copy now; the code cannot be viewed after leaving or refreshing. Expires: '}{formatDate(issued.expiresAt)}</p>
        <Input aria-label={zh ? '新邀请码' : 'New invitation code'} readOnly value={issued.token} onFocus={e => e.target.select()} />
        <Button variant="outline" onClick={() => setIssued(null)}>{zh ? '我已保存' : 'I have saved the code'}</Button>
      </div>}
      <Link className="inline-block text-sm underline" href="/invitations">{zh ? '我收到了邀请码：前往接受邀请' : 'I have a code: accept an invitation'}</Link>
      {canReadInvites && <ul className="divide-y text-sm">{invitations.map(invitation => <li key={invitation.id} className="flex flex-wrap justify-between gap-2 py-3">
        <span>{invitation.emailConstraint || (zh ? '未限制邮箱' : 'Any email')}</span>
        <span>{invitation.consumedAt ? (zh ? '已接受' : 'Accepted') : expired(invitation.expiresAt) ? (zh ? '已过期' : 'Expired') : (zh ? '待接受' : 'Pending')} · {formatDate(invitation.expiresAt)}</span>
      </li>)}{!invitations.length && <li className="text-muted-foreground">{zh ? '暂无邀请记录' : 'No invitations yet'}</li>}</ul>}
    </section>}
    {transfers && <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{zh ? '组织所有权移交' : 'Transfer organization ownership'}</h2>
      <p className="text-sm text-muted-foreground">{zh ? '负责人发起后，接收人须在本组织确认。确认后接收人成为负责人，原负责人变为管理员。请求 7 天后过期。' : 'The owner starts a request, then the recipient confirms in this organization. The recipient becomes owner and the previous owner becomes an administrator. Requests expire in 7 days.'}</p>
      {owner && <>
        <form onSubmit={search} className="flex gap-2"><Input aria-label={zh ? '查找接收人' : 'Find recipient'} placeholder={zh ? '按成员姓名或邮箱查找' : 'Find a member by name or email'} value={query} onChange={e => setQuery(e.target.value)} /><Button variant="outline">{zh ? '查找成员' : 'Find members'}</Button></form>
        <select aria-label={zh ? '选择接收人' : 'Choose recipient'} className="w-full rounded-md border bg-background p-2" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">{zh ? '从查找结果中选择成员' : 'Choose a member from search results'}</option>
          {members.map(member => <option key={member.userId} value={member.userId}>{member.displayName} · {member.email}</option>)}
        </select>
        <Button variant="outline" disabled={busy || !target} onClick={() => void mutate('owner-transfer', { toUserId: target, expiresInDays: 7 }, () => { setTarget(''); setNotice(zh ? '请求已创建。请通知接收人到本组织页面确认；系统不会自动发送通知。' : 'Request created. Ask the recipient to confirm on this organization page; no notification is sent automatically.') })}>{zh ? '发起移交请求' : 'Request transfer'}</Button>
      </>}
      <ul className="divide-y text-sm">{requests.map(request => <li key={request.id} className="space-y-2 py-3">
        <p>{request.recipientName} · {request.recipientEmail}</p>
        <p className="text-muted-foreground">{request.status === 'completed' ? (zh ? '已完成' : 'Completed') : request.status === 'cancelled' ? (zh ? '已失效' : 'Invalidated') : expired(request.expiresAt) ? (zh ? '已过期' : 'Expired') : request.status === 'pending' ? (zh ? '等待接收人确认' : 'Awaiting confirmation') : request.status} · {formatDate(request.expiresAt)}</p>
        {request.toUserId === userId && request.status === 'pending' && !expired(request.expiresAt) && <Button disabled={busy} onClick={() => void mutate('owner-transfer/confirm', { requestId: request.id }, async () => { await update(); router.refresh(); setNotice(zh ? '已接任组织负责人。' : 'You are now the organization owner.') })}>{zh ? '确认接任组织负责人' : 'Confirm and become owner'}</Button>}
      </li>)}{!requests.length && <li className="text-muted-foreground">{zh ? '暂无与你相关的移交请求' : 'No transfer requests for you'}</li>}</ul>
    </section>}
  </div>
}
