import { NextRequest, NextResponse } from 'next/server'
import {
  clampAccessTokenTtlSeconds,
  clampRefreshTokenTtlDays,
  clientAllowsGrant,
  consumeAuthorizationCode,
  getUserClaimsForToken,
  lookupRefreshTokenActive,
  scopesAllowed,
  insertRefreshTokenRow,
  isPublicClient,
  newRefreshTokenPlain,
  takeRefreshTokenForRotation,
  type OAuth2ClientRow,
} from '@/lib/oauth2/store'
import { authenticateOAuthClient, readOAuthForm, oauthJsonError as jsonError } from '@/lib/oauth2/request'
import { signAccessToken, signIdToken } from '@/lib/oauth2/jwt-as'
import { tenantArchivedBlocksOAuthIssuance } from '@/lib/tenant-lifecycle'

async function issueAccessAndId(
  client: OAuth2ClientRow,
  userId: string,
  scope: string,
  nonce: string | null
) {
  const claims = await getUserClaimsForToken(userId)
  if (!claims) return null

  const accessTtl = clampAccessTokenTtlSeconds(client)
  const accessToken = await signAccessToken({
    sub: claims.sub,
    aud: client.clientId,
    scope,
    expiresInSeconds: accessTtl,
  })

  const wantIdToken = scope.split(/\s+/).includes('openid')
  let idToken: string | undefined
  if (wantIdToken) {
    const idPayload: Parameters<typeof signIdToken>[0] = {
      sub: claims.sub,
      aud: client.clientId,
      nonce,
      expiresInSeconds: accessTtl,
    }
    if (scope.split(/\s+/).includes('email') && claims.email) {
      idPayload.email = claims.email
      idPayload.emailVerified = claims.emailVerified
    }
    if (scope.split(/\s+/).includes('profile')) {
      if (claims.name) idPayload.name = claims.name
      if (claims.picture) idPayload.picture = claims.picture
    }
    idToken = await signIdToken(idPayload)
  }

  return { accessToken, idToken, scope, claims, expiresIn: accessTtl }
}

async function maybeIssueRefreshToken(client: OAuth2ClientRow, userId: string, scope: string) {
  if (!scope.split(/\s+/).includes('offline_access')) return undefined
  if (!clientAllowsGrant(client, 'refresh_token')) return undefined
  const plain = newRefreshTokenPlain()
  const days = clampRefreshTokenTtlDays(client)
  const exp = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  await insertRefreshTokenRow({
    plainToken: plain,
    clientId: client.clientId,
    userId,
    scope,
    expiresAtIso: exp,
  })
  return plain
}

async function handleAuthorizationCode(client: OAuth2ClientRow, body: URLSearchParams) {
  const code = body.get('code')
  const redirectUri = body.get('redirect_uri')
  const clientId = client.clientId
  const codeVerifier = body.get('code_verifier')

  if (!code || !redirectUri || !clientId) {
    return jsonError(400, 'invalid_request', '缺少 code、redirect_uri 或 client_id')
  }

  if (
    client.applicationTenantId &&
    (await tenantArchivedBlocksOAuthIssuance(client.applicationTenantId))
  ) {
    return jsonError(400, 'invalid_grant', '租户已归档')
  }
  if (!clientAllowsGrant(client, 'authorization_code')) {
    return jsonError(400, 'unauthorized_client', '该客户端未启用授权码流程')
  }

  const consumed = await consumeAuthorizationCode(code, {
    clientId, redirectUri, codeVerifier, requirePkce: isPublicClient(client),
  })
  if (!consumed) return jsonError(400, 'invalid_grant', '授权码无效、已使用或 PKCE 校验失败')

  const bundle = await issueAccessAndId(client, consumed.userId, consumed.scope, consumed.nonce)
  if (!bundle) return jsonError(400, 'invalid_grant', '用户不可用')

  const refreshToken = await maybeIssueRefreshToken(client, bundle.claims.sub, bundle.scope)

  return NextResponse.json(
    {
      access_token: bundle.accessToken,
      token_type: 'Bearer',
      expires_in: bundle.expiresIn,
      scope: bundle.scope,
      ...(bundle.idToken ? { id_token: bundle.idToken } : {}),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}

async function handleRefreshToken(client: OAuth2ClientRow, body: URLSearchParams) {
  const refreshToken = body.get('refresh_token')
  const clientId = client.clientId

  if (!refreshToken || !clientId) {
    return jsonError(400, 'invalid_request', '缺少 refresh_token 或 client_id')
  }

  if (
    client.applicationTenantId &&
    (await tenantArchivedBlocksOAuthIssuance(client.applicationTenantId))
  ) {
    return jsonError(400, 'invalid_grant', '租户已归档')
  }
  if (!clientAllowsGrant(client, 'refresh_token')) {
    return jsonError(400, 'unauthorized_client', '该客户端未启用 refresh_token 授权')
  }

  const row = await lookupRefreshTokenActive(refreshToken)
  const newRefresh = newRefreshTokenPlain()
  if (!row) {
    await takeRefreshTokenForRotation(refreshToken, clientId, { plainToken: newRefresh, scope: '' })
    return jsonError(400, 'invalid_grant', 'refresh_token 无效或已吊销')
  }
  if (row.clientId !== clientId) return jsonError(400, 'invalid_grant')
  const scope = body.has('scope') ? body.get('scope')!.trim() : row.scope
  if (!scope || !scopesAllowed(scope, row.scope) || !scopesAllowed(scope, client.allowedScopes)) {
    return jsonError(400, 'invalid_scope')
  }
  const bundle = await issueAccessAndId(client, row.userId, scope, null)
  if (!bundle) return jsonError(400, 'invalid_grant', '用户不可用')
  const rotated = await takeRefreshTokenForRotation(refreshToken, clientId, { plainToken: newRefresh, scope })
  if (!rotated) return jsonError(400, 'invalid_grant', 'refresh_token 已使用')

  return NextResponse.json(
    {
      access_token: bundle.accessToken,
      token_type: 'Bearer',
      expires_in: bundle.expiresIn,
      scope: bundle.scope,
      refresh_token: newRefresh,
      ...(bundle.idToken ? { id_token: bundle.idToken } : {}),
    },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}

/**
 * OAuth2 令牌端点（授权码换 token、refresh_token）。
 * @see RFC 6749 §4.1.3、§6、OpenID Connect Core
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readOAuthForm(req)
    if (body instanceof NextResponse) return body
    const authentication = await authenticateOAuthClient(req, body)
    if (authentication.response) return authentication.response
    const grantType = body.get('grant_type')
    if (grantType === 'authorization_code') return await handleAuthorizationCode(authentication.client!, body)
    if (grantType === 'refresh_token') return await handleRefreshToken(authentication.client!, body)
    return jsonError(400, 'unsupported_grant_type')
  } catch {
    return jsonError(500, 'server_error')
  }
}
