import { NextRequest, NextResponse } from 'next/server'
import {
  getUserClaimsForToken,
  lookupRefreshTokenActive,
  isPublicClient,
} from '@/lib/oauth2/store'
import { authenticateOAuthClient, readOAuthForm, oauthJsonError } from '@/lib/oauth2/request'
import { verifyAccessToken } from '@/lib/oauth2/jwt-as'

/**
 * OAuth2 令牌自省（RFC 7662）。
 */
export async function POST(req: NextRequest) {
  const body = await readOAuthForm(req)
  if (body instanceof NextResponse) return body
  const authentication = await authenticateOAuthClient(req, body)
  if (authentication.response) return authentication.response
  const client = authentication.client!
  if (isPublicClient(client)) return oauthJsonError(401, 'invalid_client', '自省需要机密客户端认证')

  const token = body.get('token')
  if (!token) {
    return NextResponse.json({ active: false }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (token.includes('.') && token.split('.').length === 3) {
    try {
      const payload = await verifyAccessToken(token)
      const sub = typeof payload.sub === 'string' ? payload.sub : undefined
      const scope = typeof payload.scope === 'string' ? payload.scope : undefined
      const aud = typeof payload.aud === 'string' ? payload.aud : Array.isArray(payload.aud) ? String(payload.aud[0]) : undefined
      if (aud && aud !== client.clientId) {
        return NextResponse.json({ active: false }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (!sub || !(await getUserClaimsForToken(sub))) {
        return NextResponse.json({ active: false }, { headers: { 'Cache-Control': 'no-store' } })
      }
      const exp = typeof payload.exp === 'number' ? payload.exp : undefined
      const iat = typeof payload.iat === 'number' ? payload.iat : undefined
      const out: Record<string, unknown> = {
        active: true,
        token_type: 'Bearer',
        scope,
        client_id: client.clientId,
        sub,
        exp,
        iat,
      }
      if (sub) {
        const claims = await getUserClaimsForToken(sub)
        if (claims) {
          if (scope && scope.split(/\s+/).includes('email') && claims.email) out.email = claims.email
          if (scope && scope.split(/\s+/).includes('profile') && claims.name) out.name = claims.name
        }
      }
      return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
    } catch {
      return NextResponse.json({ active: false }, { headers: { 'Cache-Control': 'no-store' } })
    }
  }

  const row = await lookupRefreshTokenActive(token)
  if (!row || row.clientId !== client.clientId || !(await getUserClaimsForToken(row.userId))) {
    return NextResponse.json({ active: false }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const expMs = Date.parse(row.expiresAt)
  const expSec = Number.isFinite(expMs) ? Math.floor(expMs / 1000) : undefined
  return NextResponse.json(
    {
      active: true,
      token_type: 'refresh_token',
      scope: row.scope,
      client_id: row.clientId,
      sub: row.userId,
      ...(expSec != null ? { exp: expSec } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
