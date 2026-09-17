import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getOAuthIssuer } from '@/lib/oauth2/issuer'
import { readOAuthForm } from '@/lib/oauth2/request'
import { getServerAuthSession } from '@/lib/session'
import { clampAuthorizationCodeTtlMinutes, insertAuthorizationCode } from '@/lib/oauth2/store'
import { oauthErrRedirect, validateAuthorizeSearchParams } from '@/lib/oauth2/validate-authorize'
import { tenantArchivedBlocksOAuthIssuance } from '@/lib/tenant-lifecycle'

/**
 * 用户同意 / 拒绝授权后签发授权码（RFC 6749）。
 */
export async function POST(req: NextRequest) {
  // Browser form POSTs carry Origin. Reject missing/foreign origins, including same-site sibling apps.
  if (req.headers.get('origin') !== new URL(getOAuthIssuer()).origin) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 403 })
  }
  const body = await readOAuthForm(req)
  if (body instanceof NextResponse) return body

  const action = body.get('action')
  const sp = new URLSearchParams()
  for (const key of [
    'response_type',
    'client_id',
    'redirect_uri',
    'scope',
    'state',
    'code_challenge',
    'code_challenge_method',
    'nonce',
  ] as const) {
    const v = body.get(key)
    if (v != null) sp.set(key, v)
  }

  const validated = await validateAuthorizeSearchParams(sp)
  if (!validated.ok) return validated.response

  const { client, redirectUri, scope, state, codeChallenge, codeChallengeMethod, nonce } = validated.data

  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (session.mfaPending) {
    return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  }

  if (action === 'deny') {
    return oauthErrRedirect(redirectUri, 'access_denied', '用户拒绝授权', state)
  }

  if (action !== 'approve') {
    return NextResponse.json({ error: 'invalid_request', error_description: '无效 action' }, { status: 400 })
  }

  if (client.applicationTenantId) {
    if (await tenantArchivedBlocksOAuthIssuance(client.applicationTenantId)) {
      return oauthErrRedirect(redirectUri, 'access_denied', '租户已归档，无法签发新的授权', state)
    }
  }

  const code = randomBytes(32).toString('base64url')
  const mins = clampAuthorizationCodeTtlMinutes(client)
  const exp = new Date(Date.now() + mins * 60 * 1000).toISOString()
  await insertAuthorizationCode({
    code,
    clientId: client.clientId,
    userId: session.user.id as string,
    redirectUri,
    scope,
    expiresAtIso: exp,
    codeChallenge,
    codeChallengeMethod,
    nonce,
  })

  const ok = new URL(redirectUri)
  ok.searchParams.set('code', code)
  if (state) ok.searchParams.set('state', state)
  ok.searchParams.set('iss', getOAuthIssuer())
  return NextResponse.redirect(ok, 303)
}
