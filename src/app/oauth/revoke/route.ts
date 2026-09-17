import { NextRequest, NextResponse } from 'next/server'
import { revokeRefreshTokenByPlain } from '@/lib/oauth2/store'
import { authenticateOAuthClient, readOAuthForm, oauthJsonError } from '@/lib/oauth2/request'

/** RFC 7009: client-authenticated, client-bound refresh-token revocation. */
export async function POST(req: NextRequest) {
  const body = await readOAuthForm(req)
  if (body instanceof NextResponse) return body
  const authentication = await authenticateOAuthClient(req, body)
  if (authentication.response) return authentication.response
  const token = body.get('token')
  if (!token) return oauthJsonError(400, 'invalid_request')
  if (body.get('token_type_hint') === 'access_token') {
    return oauthJsonError(400, 'unsupported_token_type', 'JWT access_token 在过期前仍有效；仅支持 refresh_token 吊销')
  }
  await revokeRefreshTokenByPlain(token, authentication.client!.clientId)
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
