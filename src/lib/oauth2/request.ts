import { NextResponse } from 'next/server'
import { getOAuth2ClientByClientId, isPublicClient, verifyClientSecret } from '@/lib/oauth2/store'

export function oauthJsonError(status: number, error: string, description?: string) {
  return NextResponse.json({ error, ...(description ? { error_description: description } : {}) }, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache',
      ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="oauth"' } : {}) },
  })
}

export async function readOAuthForm(req: Request): Promise<URLSearchParams | NextResponse> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    return oauthJsonError(400, 'invalid_request', '需要 application/x-www-form-urlencoded')
  }
  const body = new URLSearchParams(await req.text())
  for (const key of body.keys()) {
    if (body.getAll(key).length > 1) return oauthJsonError(400, 'invalid_request', '不允许重复参数')
  }
  return body
}

export async function authenticateOAuthClient(req: Request, body: URLSearchParams) {
  let clientId = body.get('client_id')
  let clientSecret = body.get('client_secret')
  const authorization = req.headers.get('authorization')
  if (authorization) {
    if (body.has('client_secret')) return { response: oauthJsonError(400, 'invalid_request', '不能混用客户端认证方式') }
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)
    if (!match) return { response: oauthJsonError(401, 'invalid_client') }
    const decoded = Buffer.from(match[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon < 0) return { response: oauthJsonError(401, 'invalid_client') }
    try {
      const id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '))
      clientSecret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '))
      if (clientId && clientId !== id) return { response: oauthJsonError(400, 'invalid_request', 'client_id 不一致') }
      clientId = id
    } catch {
      return { response: oauthJsonError(401, 'invalid_client') }
    }
  }
  if (!clientId) return { response: oauthJsonError(401, 'invalid_client') }
  const client = await getOAuth2ClientByClientId(clientId)
  if (!client || (isPublicClient(client)
    ? authorization != null || body.has('client_secret')
    : !verifyClientSecret(client, clientSecret))) {
    return { response: oauthJsonError(401, 'invalid_client') }
  }
  return { client }
}
