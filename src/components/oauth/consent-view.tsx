'use client'

import { useI18n } from '@/i18n/context'
import { Button } from '@/components/ui/button'
import { PageShell, PageHeader } from '@/components/layout/page-shell'

const scopeDescriptions: Record<string, [string, string]> = {
  openid: ['确认你的身份，并向应用提供账号标识。', 'Confirm your identity and share your account identifier.'],
  profile: ['读取你的基本资料，例如姓名和头像。', 'Read your basic profile, such as your name and picture.'],
  email: ['读取你的邮箱地址及邮箱验证状态。', 'Read your email address and its verification status.'],
  offline_access: ['允许应用在访问令牌过期后使用刷新令牌继续访问已同意的信息，直到刷新令牌过期或被撤销。', 'Let the app renew access to the information you approve until its refresh token expires or is revoked.'],
}

export function ConsentView({ applicationName, account, redirectUri, fields, links }: {
  applicationName: string; account: string; redirectUri: string; fields: Record<string, string>
  links: { href: string; kind: 'home' | 'privacy' | 'terms' }[]
}) {
  const { locale } = useI18n()
  const zh = locale === 'zh'
  const destination = new URL(redirectUri).host
  const labels = { home: zh ? '应用主页' : 'Application website', privacy: zh ? '隐私政策' : 'Privacy policy', terms: zh ? '服务条款' : 'Terms' }
  return <PageShell mainVariant="narrow">
    <PageHeader title={zh ? `登录 ${applicationName}` : `Sign in to ${applicationName}`} description={zh ? '检查应用请求的信息，确认后继续。' : 'Review the information requested by this application before continuing.'} />
    <section className="space-y-6 rounded-xl border bg-card p-6">
      <div><p className="text-sm text-muted-foreground">{zh ? '正在使用的账号' : 'Your account'}</p><p className="mt-1 break-all font-medium">{account}</p></div>
      <div><h2 className="font-semibold">{zh ? '此应用请求以下访问权限' : 'This application requests access to'}</h2>
        <ul className="mt-3 space-y-3">{fields.scope.split(/\s+/).filter(Boolean).map(scope => <li key={scope} className="rounded-lg bg-muted p-3 text-sm">
          <p>{scopeDescriptions[scope]?.[zh ? 0 : 1] || (zh ? `应用请求自定义权限：${scope}。如不确定用途，请联系应用提供方。` : `The app requests a custom permission: ${scope}. Contact its provider if you are unsure what it allows.`)}</p>
          <code className="mt-1 block text-xs text-muted-foreground">{scope}</code>
        </li>)}</ul>
      </div>
      <p className="text-sm">{zh ? '授权后返回：' : 'Continue to: '}<strong className="break-all">{destination}</strong></p>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{zh ? '查看完整回调地址' : 'Full callback URL'}</summary><p className="mt-2 break-all font-mono text-xs">{redirectUri}</p></details>
      <div className="flex flex-wrap gap-4 text-sm">{links.map(link => <a key={link.kind} href={link.href} target="_blank" rel="noopener noreferrer" className="underline">{labels[link.kind]}</a>)}</div>
      <form method="post" action="/api/oauth/consent" className="flex flex-wrap gap-3">
        {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <Button type="submit" name="action" value="approve">{zh ? '同意并继续' : 'Allow and continue'}</Button>
        <Button type="submit" name="action" value="deny" variant="outline">{zh ? '取消登录' : 'Cancel sign-in'}</Button>
      </form>
    </section>
  </PageShell>
}
