import { NextRequest, NextResponse } from 'next/server'
import { oauthPostLogoutRedirectUriAllowlist } from '@/lib/oauth2/redirect-allowlist-env'
import { getOAuth2ClientByClientId, parseRedirectUris, redirectUriAllowed } from '@/lib/oauth2/store'
import { verifyIdTokenHint } from '@/lib/oauth2/jwt-as'
import { signLogoutTicket } from '@/lib/oauth2/logout-ticket'
import { oauthJsonError } from '@/lib/oauth2/request'

/** The Auth.js confirmation page handles CSRF and clears the entire session cookie (including chunks). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  for (const key of sp.keys()) {
    if (sp.getAll(key).length > 1) return oauthJsonError(400, 'invalid_request')
  }
  let clientId = sp.get('client_id')
  const hint = sp.get('id_token_hint')
  if (hint) {
    try {
      const claims = await verifyIdTokenHint(hint)
      if (clientId && clientId !== claims.aud) return oauthJsonError(400, 'invalid_request')
      clientId = claims.aud as string
    } catch {
      return oauthJsonError(400, 'invalid_request', 'id_token_hint 无效')
    }
  }
  const postLogout = sp.get('post_logout_redirect_uri')
  const client = clientId ? await getOAuth2ClientByClientId(clientId) : null
  if (clientId && !client) return oauthJsonError(400, 'invalid_client')
  if (postLogout && (!client || !redirectUriAllowed(postLogout,
    oauthPostLogoutRedirectUriAllowlist(parseRedirectUris(client.postLogoutRedirectUrisJson))))) {
    return oauthJsonError(400, 'invalid_request', 'post_logout_redirect_uri 未在客户端登记')
  }
  let target: URL
  try {
    target = postLogout ? new URL(postLogout) : new URL('/login', req.nextUrl.origin)
  } catch {
    return oauthJsonError(400, 'invalid_request')
  }
  if (sp.has('state')) target.searchParams.set('state', sp.get('state')!)
  const complete = new URL('/oauth/logout/complete', req.nextUrl.origin)
  complete.searchParams.set('ticket', await signLogoutTicket(clientId, target.toString()))
  const signout = new URL('/api/auth/signout', req.nextUrl.origin)
  signout.searchParams.set('callbackUrl', complete.toString())
  return NextResponse.redirect(signout, { status: 303, headers: { 'Cache-Control': 'no-store' } })
}
