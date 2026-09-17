import { auth } from '@/auth'
import { ConsentView } from '@/components/oauth/consent-view'
import Link from 'next/link'
import { validateAuthorizeSearchParams } from '@/lib/oauth2/validate-authorize'
import { getOAuth2ClientByClientId } from '@/lib/oauth2/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { PageShell, PageHeader } from '@/components/layout/page-shell'

type SearchParams = Record<string, string | string[] | undefined>

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') sp.set(k, v)
    else if (Array.isArray(v) && v[0]) sp.set(k, v[0])
  }

  const validated = await validateAuthorizeSearchParams(sp)
  if (!validated.ok) {
    return (
      <PageShell>
        <PageHeader title="授权" description="请求参数无效或客户端校验未通过。" />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            请从第三方应用重新发起登录；若问题持续，请联系管理员检查 client_id、redirect_uri 与 PKCE 配置。
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/">返回首页</Link>
            </Button>
          </CardFooter>
        </Card>
      </PageShell>
    )
  }

  const { clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, nonce, responseType } =
    validated.data
  const row = await getOAuth2ClientByClientId(clientId)
  const appName = row?.name ?? clientId
  const session = await auth()
  const fields: Record<string, string> = {
    response_type: responseType, client_id: clientId, redirect_uri: redirectUri, scope,
  }
  if (state) fields.state = state
  if (codeChallenge) fields.code_challenge = codeChallenge
  if (codeChallengeMethod) fields.code_challenge_method = codeChallengeMethod
  if (nonce) fields.nonce = nonce
  const links: { href: string; kind: 'home' | 'privacy' | 'terms' }[] = []
  if (row?.clientUri) links.push({ href: row.clientUri, kind: 'home' })
  if (row?.policyUri) links.push({ href: row.policyUri, kind: 'privacy' })
  if (row?.tosUri) links.push({ href: row.tosUri, kind: 'terms' })
  return <ConsentView applicationName={appName} account={session?.user?.email || session?.user?.name || ''} redirectUri={redirectUri} fields={fields} links={links} />
}
