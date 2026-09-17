import { NextResponse } from 'next/server'
import { getOAuthIssuer } from '@/lib/oauth2/issuer'
import { oauthAuthorizeRedirectUriAllowlist } from '@/lib/oauth2/redirect-allowlist-env'
import {
  clientAllowsGrant,
  getOAuth2ClientByClientId,
  isPublicClient,
  parseRedirectUris,
  redirectUriAllowed,
  scopesAllowed,
  type OAuth2ClientRow,
} from '@/lib/oauth2/store'

export function oauthErrRedirect(redirectUri: string, error: string, desc: string, state: string | null) {
  const u = new URL(redirectUri)
  u.searchParams.set('error', error)
  u.searchParams.set('error_description', desc)
  if (state) u.searchParams.set('state', state)
  u.searchParams.set('iss', getOAuthIssuer())
  return NextResponse.redirect(u, 303)
}

export type AuthorizeValidated = {
  client: OAuth2ClientRow
  responseType: string
  clientId: string
  redirectUri: string
  scope: string
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  nonce: string | null
}

/**
 * 校验 OAuth2 授权请求查询参数（RFC 6749 / OIDC）。
 * 成功时返回客户端行与规范化参数，失败时返回可直接响应的 NextResponse。
 */
export async function validateAuthorizeSearchParams(sp: URLSearchParams): Promise<
  | { ok: true; data: AuthorizeValidated }
  | { ok: false; response: NextResponse }
> {
  for (const key of sp.keys()) {
    if (sp.getAll(key).length > 1) return { ok: false, response: NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }
  }
  const responseType = sp.get('response_type')
  const clientId = sp.get('client_id')
  const redirectUri = sp.get('redirect_uri')
  const scopeRaw = sp.get('scope')?.trim() || 'openid'
  const state = sp.get('state')
  const codeChallenge = sp.get('code_challenge')
  const codeChallengeMethod = sp.get('code_challenge_method')
  const nonce = sp.get('nonce')

  if (responseType !== 'code') {
    return { ok: false, response: NextResponse.json({ error: 'unsupported_response_type' }, { status: 400 }) }
  }
  if (!clientId || !redirectUri) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'invalid_request', error_description: '缺少 client_id 或 redirect_uri' },
        { status: 400 }
      ),
    }
  }

  let client: OAuth2ClientRow | null
  try {
    client = await getOAuth2ClientByClientId(clientId)
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'server_error' }, { status: 500 }) }
  }
  if (!client) {
    return { ok: false, response: NextResponse.json({ error: 'invalid_client' }, { status: 400 }) }
  }

  const uris = oauthAuthorizeRedirectUriAllowlist(parseRedirectUris(client.redirectUrisJson))
  if (!redirectUriAllowed(redirectUri, uris)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'invalid_request', error_description: 'redirect_uri 未在客户端登记白名单内' },
        { status: 400 }
      ),
    }
  }

  if (!scopesAllowed(scopeRaw, client.allowedScopes)) {
    return { ok: false, response: oauthErrRedirect(redirectUri, 'invalid_scope', '请求的 scope 超出客户端允许范围', state) }
  }

  if (!clientAllowsGrant(client, 'authorization_code')) {
    return {
      ok: false,
      response: oauthErrRedirect(redirectUri, 'unauthorized_client', '该客户端未启用授权码（authorization_code）流程', state),
    }
  }

  if (scopeRaw.split(/\s+/).includes('offline_access') && !clientAllowsGrant(client, 'refresh_token')) {
    return {
      ok: false,
      response: oauthErrRedirect(
        redirectUri,
        'invalid_scope',
        '客户端未启用 refresh_token 授权，不能请求 offline_access',
        state
      ),
    }
  }

  if (sp.has('response_mode') && sp.get('response_mode') !== 'query') {
    return { ok: false, response: oauthErrRedirect(redirectUri, 'invalid_request', '仅支持 query response_mode', state) }
  }
  const prompt = sp.get('prompt')
  if (prompt === 'none') {
    return { ok: false, response: oauthErrRedirect(redirectUri, 'consent_required', '需要交互确认授权', state) }
  }
  if (prompt && prompt !== 'consent') {
    return { ok: false, response: oauthErrRedirect(redirectUri, 'invalid_request', '目前仅支持 consent / none prompt', state) }
  }
  const pub = isPublicClient(client)
  if ((codeChallenge && !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) || (codeChallengeMethod && !codeChallenge)) {
    return { ok: false, response: oauthErrRedirect(redirectUri, 'invalid_request', 'PKCE 参数无效', state) }
  }
  if (codeChallenge && codeChallengeMethod !== 'S256') {
    return {
      ok: false,
      response: oauthErrRedirect(redirectUri, 'invalid_request', '使用 PKCE 时须为 code_challenge_method=S256', state),
    }
  }
  if (pub && !codeChallenge) {
    return {
      ok: false,
      response: oauthErrRedirect(
        redirectUri,
        'invalid_request',
        '公开客户端必须使用 PKCE（code_challenge + code_challenge_method=S256）',
        state
      ),
    }
  }

  return {
    ok: true,
    data: {
      client,
      responseType,
      clientId,
      redirectUri,
      scope: scopeRaw,
      state,
      codeChallenge: codeChallenge || null,
      codeChallengeMethod: codeChallengeMethod || null,
      nonce,
    },
  }
}
