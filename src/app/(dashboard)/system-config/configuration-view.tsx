'use client'

import Link from 'next/link'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { useI18n } from '@/i18n/context'

export function ConfigurationView({ issuer, issuerSource, sessionDays, totpIssuer, totpSource }: {
  issuer: string; issuerSource: string; sessionDays: number; totpIssuer: string; totpSource: string
}) {
  const { locale } = useI18n()
  const zh = locale === 'zh'
  const rows = [
    { name: zh ? '产品名称' : 'Product name', value: 'ProfileHub', source: zh ? '界面与页面元数据' : 'UI and page metadata', hint: zh ? '修改数据库中的站点名称不会改变界面品牌。' : 'The database site name does not change the product brand.' },
    { name: 'OAuth / OIDC Issuer', value: issuer || (zh ? '尚未配置' : 'Not configured'), source: issuerSource, hint: zh ? '业务应用使用的身份服务根地址。由部署环境配置，修改后需重新部署。' : 'The identity service URL used by applications. Set in the deployment environment and redeploy to change it.' },
    { name: zh ? '登录会话最长有效期' : 'Maximum sign-in session lifetime', value: zh ? `${sessionDays} 天` : `${sessionDays} days`, source: 'src/lib/session-policy.ts', hint: zh ? '不是空闲超时。旧版数据库 session_timeout 字段不控制此期限。' : 'This is not an idle timeout. The legacy database session_timeout field does not control this lifetime.' },
    { name: zh ? '验证器显示名称' : 'Authenticator issuer name', value: totpIssuer, source: totpSource, hint: zh ? '用于新生成的验证器配置，不会修改已经添加到验证器中的名称。' : 'Used in new authenticator setups; existing entries are not renamed.' },
  ]
  return <PageShell>
    <PageHeader title={zh ? '配置说明' : 'Configuration'} description={zh ? '查看当前运行时使用的配置及其来源。这些配置影响整个部署，不仅是当前组织。' : 'View active configuration and its sources. These values affect the whole deployment, not just this organization.'} />
    <div className="rounded-xl border bg-card divide-y">
      {rows.map(row => <section key={row.name} className="space-y-2 p-5">
        <h2 className="font-medium">{row.name}</h2>
        <p className="break-all">{row.value}</p>
        <p className="text-sm text-muted-foreground">{row.hint}</p>
        <p className="text-xs text-muted-foreground">{zh ? '配置来源：' : 'Source: '}<code>{row.source}</code></p>
      </section>)}
    </div>
    <p className="text-sm text-muted-foreground">{zh ? '应用的回调地址、访问范围和客户端凭据，请在应用接入中配置。' : 'Configure application callbacks, scopes, and credentials under Applications.'} <Link href="/applications" className="underline">{zh ? '应用接入' : 'Applications'}</Link></p>
  </PageShell>
}
