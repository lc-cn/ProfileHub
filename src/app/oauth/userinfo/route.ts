import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '@/lib/oauth2/jwt-as'
import { getUserClaimsForToken } from '@/lib/oauth2/store'

/**
 * OIDC UserInfo（需 Bearer access_token）。
 */
export async function GET(req: NextRequest) {
  const h = req.headers.get('authorization')
  if (!h?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }
  const raw = h.slice(7).trim()
  try {
    const payload = await verifyAccessToken(raw)
    const sub = typeof payload.sub === 'string' ? payload.sub : null
    if (!sub) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

    const claims = await getUserClaimsForToken(sub)
    if (!claims) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

    const scope = typeof payload.scope === 'string' ? payload.scope : ''
    const out: Record<string, unknown> = { sub: claims.sub }
    if (scope.split(/\s+/).includes('email') && claims.email) {
      out.email = claims.email
      out.email_verified = claims.emailVerified
    }
    if (scope.split(/\s+/).includes('profile')) {
      if (claims.name) out.name = claims.name
      if (claims.picture) out.picture = claims.picture
    }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 })
  }
}

export const POST = GET
