import { createPrivateKey, createPublicKey } from 'node:crypto'
import { compactVerify, decodeProtectedHeader, exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload, type JWK } from 'jose'
import { getOAuthIssuer } from '@/lib/oauth2/issuer'

const RSA_KID = 'oauth-rsa-1'

function loadPemPrivate(): string | null {
  const b64 = process.env.OAUTH_RSA_PRIVATE_KEY_B64?.trim()
  if (b64) {
    try {
      return Buffer.from(b64, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  const pem = process.env.OAUTH_RSA_PRIVATE_KEY_PEM?.trim()
  if (pem) {
    return pem.replace(/\\n/g, '\n')
  }
  return null
}

type RsaCached = { privateKey: Awaited<ReturnType<typeof importPKCS8>>; publicSpkiPem: string }
let rsaCache: { pem: string; material: RsaCached } | undefined

async function getRsaMaterial(): Promise<RsaCached | null> {
  const pem = loadPemPrivate()
  if (!pem) return null
  if (rsaCache?.pem === pem) return rsaCache.material
  try {
    const pk = createPrivateKey(pem)
    const publicSpkiPem = createPublicKey(pk).export({ type: 'spki', format: 'pem' }) as string
    const privateKey = await importPKCS8(pem, 'RS256')
    const material = { privateKey, publicSpkiPem }
    rsaCache = { pem, material }
    return material
  } catch {
    throw new Error('OAuth RSA 私钥无效，必须配置有效的 PKCS8 RSA 私钥')
  }
}

function secretKey(): Uint8Array {
  const raw = (process.env.OAUTH_JWT_SECRET || process.env.NEXTAUTH_SECRET || '').trim()
  if (raw.length < 32) {
    throw new Error('OAUTH_JWT_SECRET 或 NEXTAUTH_SECRET 须至少 32 字符，用于签发 OAuth2 access_token / id_token')
  }
  return new TextEncoder().encode(raw)
}

/** Discovery：当前支持的 id_token / access_token 签名算法列表 */
export async function oauthSigningAlgsSupported(): Promise<string[]> {
  if (!(await getRsaMaterial())) throw new Error('OIDC 需要配置 OAUTH_RSA_PRIVATE_KEY_PEM 或 OAUTH_RSA_PRIVATE_KEY_B64')
  return ['RS256']
}

export async function getOAuthJwks(): Promise<{ keys: JWK[] }> {
  const rsa = await getRsaMaterial()
  if (!rsa) return { keys: [] }
  const pub = await importSPKI(rsa.publicSpkiPem, 'RS256')
  const jwk = await exportJWK(pub)
  jwk.kid = RSA_KID
  jwk.use = 'sig'
  jwk.alg = 'RS256'
  return { keys: [jwk] }
}

function ttlSeconds(raw?: number | null): number {
  const n = raw == null || !Number.isFinite(raw) ? 3600 : Math.floor(raw)
  return Math.min(86400, Math.max(300, n))
}

export async function signAccessToken(params: {
  sub: string
  aud: string
  scope: string
  /** 秒，默认 3600，范围 300–86400 */
  expiresInSeconds?: number | null
}): Promise<string> {
  const issuer = getOAuthIssuer()
  const expUnix = Math.floor(Date.now() / 1000) + ttlSeconds(params.expiresInSeconds ?? undefined)
  const rsa = await getRsaMaterial()
  if (rsa) {
    return new SignJWT({ scope: params.scope, token_use: 'access' })
      .setProtectedHeader({ alg: 'RS256', kid: RSA_KID })
      .setIssuer(issuer)
      .setSubject(params.sub)
      .setAudience(params.aud)
      .setIssuedAt()
      .setExpirationTime(expUnix)
      .sign(rsa.privateKey)
  }
  return new SignJWT({ scope: params.scope, token_use: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setSubject(params.sub)
    .setAudience(params.aud)
    .setIssuedAt()
    .setExpirationTime(expUnix)
    .sign(secretKey())
}

export async function signIdToken(params: {
  sub: string
  aud: string
  nonce?: string | null
  email?: string
  emailVerified?: boolean
  name?: string
  picture?: string
  /** 与 access_token 对齐；秒，默认 3600，范围 300–86400 */
  expiresInSeconds?: number | null
}): Promise<string> {
  const issuer = getOAuthIssuer()
  const body: Record<string, unknown> = {}
  if (params.email != null) body.email = params.email
  if (params.emailVerified != null) body.email_verified = params.emailVerified
  if (params.name != null) body.name = params.name
  if (params.picture != null) body.picture = params.picture
  if (params.nonce) body.nonce = params.nonce

  const expUnix = Math.floor(Date.now() / 1000) + ttlSeconds(params.expiresInSeconds ?? undefined)
  const rsa = await getRsaMaterial()
  if (rsa) {
    return new SignJWT(body)
      .setProtectedHeader({ alg: 'RS256', kid: RSA_KID })
      .setIssuer(issuer)
      .setSubject(params.sub)
      .setAudience(params.aud)
      .setIssuedAt()
      .setExpirationTime(expUnix)
      .sign(rsa.privateKey)
  }
  throw new Error('OIDC ID Token 签发需要配置 RSA 私钥')
}

/** Logout hints may be expired, but must still be signed ID tokens for this issuer. */
export async function verifyIdTokenHint(token: string): Promise<JWTPayload> {
  const rsa = await getRsaMaterial()
  if (!rsa) throw new Error('RSA key required')
  const pub = await importSPKI(rsa.publicSpkiPem, 'RS256')
  const verified = await compactVerify(token, pub, { algorithms: ['RS256'] })
  const payload = JSON.parse(new TextDecoder().decode(verified.payload)) as JWTPayload
  if (payload.iss !== getOAuthIssuer() || typeof payload.sub !== 'string' ||
      typeof payload.aud !== 'string' || typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' || payload.token_use != null) throw new Error('invalid ID token hint')
  return payload
}

export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const issuer = getOAuthIssuer()
  let alg: string
  try {
    alg = decodeProtectedHeader(token).alg ?? ''
  } catch {
    throw new Error('invalid token')
  }
  if (alg === 'RS256') {
    const rsa = await getRsaMaterial()
    if (!rsa) throw new Error('invalid token alg')
    const pub = await importSPKI(rsa.publicSpkiPem, 'RS256')
    const { payload } = await jwtVerify(token, pub, {
      issuer,
      algorithms: ['RS256'],
    })
    if (payload.token_use !== 'access') throw new Error('invalid token type')
    return payload
  }
  if (alg === 'HS256') {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer,
      algorithms: ['HS256'],
    })
    if (payload.token_use !== 'access') throw new Error('invalid token type')
    return payload
  }
  throw new Error('unsupported alg')
}
