import { NextResponse } from 'next/server'
import { getOAuthIssuer } from '@/lib/oauth2/issuer'
import { getOAuthJwks, oauthSigningAlgsSupported } from '@/lib/oauth2/jwt-as'

export async function GET() {
  try {
    const issuer = getOAuthIssuer()
    const signingAlgs = await oauthSigningAlgsSupported()
    const jwks = await getOAuthJwks()
    const hasJwks = jwks.keys.length > 0

    const meta = {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      end_session_endpoint: `${issuer}/oauth/logout`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      introspection_endpoint: `${issuer}/oauth/introspect`,
      ...(hasJwks ? { jwks_uri: `${issuer}/.well-known/jwks.json` } : {}),
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      response_modes_supported: ['query'],
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: signingAlgs,
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'email_verified', 'name', 'picture', 'nonce'],
    }

    return NextResponse.json(meta, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch {
    return NextResponse.json({ error: 'server_error', error_description: 'OIDC issuer 或 RSA 签名密钥配置不可用' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
