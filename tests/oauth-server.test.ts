import { test, before, after, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { createLocalJWKSet, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'

let session: { user: { id: string }; mfaPending?: boolean } | null = { user: { id: 'user' } }
mock.module('../src/lib/session.ts', { namedExports: { getServerAuthSession: async () => session } })
const { POST: token } = await import('../src/app/oauth/token/route.ts')
const { POST: consent } = await import('../src/app/api/oauth/consent/route.ts')
const { POST: introspect } = await import('../src/app/oauth/introspect/route.ts')
const { POST: revoke } = await import('../src/app/oauth/revoke/route.ts')
const { GET: userinfo } = await import('../src/app/oauth/userinfo/route.ts')
const { GET: discovery } = await import('../src/app/.well-known/openid-configuration/route.ts')
const { GET: logout } = await import('../src/app/oauth/logout/route.ts')
const { GET: completeLogout } = await import('../src/app/oauth/logout/complete/route.ts')
const store = await import('../src/lib/oauth2/store.ts')
const jwt = await import('../src/lib/oauth2/jwt-as.ts')
const { validateAuthorizeSearchParams } = await import('../src/lib/oauth2/validate-authorize.ts')
const issuer = 'https://idp.example.test'
const redirectUri = 'https://rp.example.test/api/auth/callback/rbac'
const verifier = 'a'.repeat(43)
const challenge = createHash('sha256').update(verifier).digest('base64url')
const scope = 'openid profile email offline_access'
const globals = globalThis as unknown as { libsql?: Client }
let db: Client
let pem: string
let temp: string

function request(path: string, values: Record<string, string>, headers: Record<string, string> = {}) {
  return new NextRequest(`${issuer}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(values) })
}
const auth = { client_id: 'client', client_secret: 'secret' }
function exchange(code: string, extra: Record<string, string> = {}) {
  return token(request('/oauth/token', { ...auth, grant_type: 'authorization_code', code,
    redirect_uri: redirectUri, code_verifier: verifier, ...extra }))
}
async function code(name: string) {
  await store.insertAuthorizationCode({ code: name, clientId: 'client', userId: 'user', redirectUri,
    scope, expiresAtIso: new Date(Date.now() + 60_000).toISOString(), codeChallenge: challenge,
    codeChallengeMethod: 'S256', nonce: 'nonce-123' })
}
async function refresh(plain: string, extra: Record<string, string> = {}) {
  return token(request('/oauth/token', { ...auth, grant_type: 'refresh_token', refresh_token: plain, ...extra }))
}

before(async () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  pem = key.export({ type: 'pkcs8', format: 'pem' }) as string
  process.env.OAUTH_RSA_PRIVATE_KEY_PEM = pem
  process.env.OAUTH_ISSUER_URL = issuer
  process.env.NEXTAUTH_SECRET = 'test-secret-32-characters-minimum-for-oauth'
  delete process.env.OAUTH_RSA_PRIVATE_KEY_B64
  temp = await mkdtemp(join(tmpdir(), 'oauth-tests-'))
  db = createClient({ url: `file:${join(temp, 'test.db')}` })
  globals.libsql = db
  await db.executeMultiple(await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'))
  await db.execute(`INSERT INTO "User" (id,name,email,emailVerified) VALUES ('user','User','u@example.test',CURRENT_TIMESTAMP)`)
  await db.execute(`INSERT INTO "Application" (id,name,code,"tenantId") VALUES ('app','App','app','tenant_default')`)
  await db.execute({ sql: `INSERT INTO "OAuth2Client" (id,"applicationId","clientId","clientSecretHash","redirectUrisJson","allowedScopes","postLogoutRedirectUrisJson") VALUES (?,?,?,?,?,?,?)`,
    args: ['client-row', 'app', 'client', bcrypt.hashSync('secret', 4), JSON.stringify([redirectUri]), scope, JSON.stringify(['https://rp.example.test/logged-out'])] })
  await db.execute(`INSERT INTO "Application" (id,name,code,"tenantId") VALUES ('other-app','Other','other','tenant_default')`)
  await db.execute({ sql: `INSERT INTO "OAuth2Client" (id,"applicationId","clientId","redirectUrisJson","allowedScopes") VALUES (?,?,?,?,?)`,
    args: ['other-row','other-app','public',JSON.stringify([redirectUri]),scope] })
})
beforeEach(async () => {
  process.env.OAUTH_RSA_PRIVATE_KEY_PEM = pem
  session = { user: { id: 'user' } }
  await db.execute('DELETE FROM "OAuth2AuthorizationCode"')
  await db.execute('DELETE FROM "OAuth2RefreshToken"')
})
after(async () => { db?.close(); delete globals.libsql; if (temp) await rm(temp, { recursive: true, force: true }) })

test('discovery, RS256 JWKS, nonce and claims support a verifiable OIDC exchange', async () => {
  const metadata = await (await discovery()).json()
  assert.equal(metadata.jwks_uri, `${issuer}/.well-known/jwks.json`)
  assert.deepEqual(metadata.id_token_signing_alg_values_supported, ['RS256'])
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  assert.ok(metadata.token_endpoint_auth_methods_supported.includes('none'))
  await code('valid')
  const res = await exchange('valid')
  assert.equal(res.status, 200)
  const tokens = await res.json()
  const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(await jwt.getOAuthJwks()), {
    issuer, audience: 'client', algorithms: ['RS256'],
  })
  assert.equal(payload.nonce, 'nonce-123')
  assert.equal(payload.email_verified, true)
  const profile = await (await userinfo(new NextRequest(`${issuer}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  }))).json()
  assert.equal(profile.sub, payload.sub)
  assert.equal(profile.email_verified, true)
})

test('invalid or missing RSA configuration fails closed', async () => {
  process.env.OAUTH_RSA_PRIVATE_KEY_PEM = 'invalid'
  assert.equal((await discovery()).status, 503)
  await assert.rejects(jwt.signIdToken({ sub: 'user', aud: 'client' }))
  delete process.env.OAUTH_RSA_PRIVATE_KEY_PEM
  assert.equal((await discovery()).status, 503)
  await assert.rejects(jwt.signIdToken({ sub: 'user', aud: 'client' }))
})

test('wrong credentials, redirect and verifier do not consume an authorization code', async () => {
  await code('retry')
  assert.equal((await exchange('retry', { client_secret: 'bad' })).status, 401)
  assert.equal((await exchange('retry', { redirect_uri: 'https://wrong.test' })).status, 400)
  assert.equal((await exchange('retry', { code_verifier: 'b'.repeat(43) })).status, 400)
  assert.equal((await exchange('retry')).status, 200)
  assert.equal((await exchange('retry')).status, 400)
})

test('concurrent authorization-code exchange has only one winner', async () => {
  await code('race')
  const responses = await Promise.all([exchange('race'), exchange('race')])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400])
})

test('refresh narrows scopes, keeps absolute expiry and detects old-token reuse', async () => {
  await code('refresh')
  const initial = await (await exchange('refresh')).json()
  const first = await store.lookupRefreshTokenActive(initial.refresh_token)
  assert.equal((await refresh(initial.refresh_token, { scope: 'openid admin' })).status, 400)
  assert.equal((await refresh(initial.refresh_token, { client_id: 'public', client_secret: '' })).status, 401)
  const narrowed = await (await refresh(initial.refresh_token, { scope: 'openid email' })).json()
  assert.equal(narrowed.scope, 'openid email')
  assert.equal((await store.lookupRefreshTokenActive(narrowed.refresh_token))?.expiresAt, first?.expiresAt)
  assert.equal((await refresh(initial.refresh_token)).status, 400)
  assert.equal(await store.lookupRefreshTokenActive(narrowed.refresh_token), null)
})

test('wrong client cannot consume or revoke refresh tokens; authenticated owner can revoke', async () => {
  await code('isolation')
  const initial = await (await exchange('isolation')).json()
  const plain = initial.refresh_token
  assert.equal(await store.takeRefreshTokenForRotation(plain, 'public', { plainToken: 'replacement', scope }), null)
  assert.equal((await revoke(request('/oauth/revoke', { token: plain }))).status, 401)
  assert.equal((await revoke(request('/oauth/revoke', { client_id: 'public', token: plain }))).status, 200)
  assert.ok(await store.lookupRefreshTokenActive(plain))
  assert.equal((await revoke(request('/oauth/revoke', { ...auth, token: plain }))).status, 200)
  assert.equal(await store.lookupRefreshTokenActive(plain), null)
})

test('consent enforces Origin and redirects with GET semantics and issuer', async () => {
  const form = { client_id: 'client', redirect_uri: redirectUri, response_type: 'code', scope,
    state: 'state', nonce: 'nonce', code_challenge: challenge, code_challenge_method: 'S256', action: 'approve' }
  assert.equal((await consent(request('/api/oauth/consent', form))).status, 403)
  assert.equal((await consent(request('/api/oauth/consent', form, { origin: 'https://evil.test' }))).status, 403)
  const approved = await consent(request('/api/oauth/consent', form, { origin: issuer }))
  assert.equal(approved.status, 303)
  const url = new URL(approved.headers.get('location')!)
  assert.equal(url.searchParams.get('iss'), issuer)
  assert.equal(url.searchParams.get('state'), 'state')
  assert.ok(url.searchParams.get('code'))
  const denied = await consent(request('/api/oauth/consent', { ...form, action: 'deny' }, { origin: issuer }))
  assert.equal(denied.status, 303)
  assert.equal(new URL(denied.headers.get('location')!).searchParams.get('error'), 'access_denied')
})

test('public clients require valid S256 PKCE; prompts are not silently ignored', async () => {
  const params = new URLSearchParams({ client_id: 'public', redirect_uri: redirectUri, response_type: 'code', scope })
  assert.equal((await validateAuthorizeSearchParams(params)).ok, false)
  params.set('code_challenge', challenge); params.set('code_challenge_method', 'S256')
  assert.equal((await validateAuthorizeSearchParams(params)).ok, true)
  params.set('prompt', 'none')
  const result = await validateAuthorizeSearchParams(params)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(new URL(result.response.headers.get('location')!).searchParams.get('error'), 'consent_required')
})

test('logout uses a signed same-origin callback, requires confirmation, then returns state to RP', async () => {
  const hint = await jwt.signIdToken({ sub: 'user', aud: 'client' })
  const params = new URLSearchParams({ id_token_hint: hint, post_logout_redirect_uri: 'https://rp.example.test/logged-out', state: 'logout-state' })
  const response = await logout(new NextRequest(`${issuer}/oauth/logout?${params}`))
  assert.equal(response.status, 303)
  const signout = new URL(response.headers.get('location')!)
  assert.equal(signout.pathname, '/api/auth/signout')
  const callback = signout.searchParams.get('callbackUrl')!
  assert.equal(new URL(callback).origin, issuer)
  assert.equal((await completeLogout(new NextRequest(callback))).status, 400)
  session = null
  const completed = await completeLogout(new NextRequest(callback))
  assert.equal(completed.headers.get('location'), 'https://rp.example.test/logged-out?state=logout-state')
  assert.equal((await completeLogout(new NextRequest(`${issuer}/oauth/logout/complete?ticket=forged`))).status, 400)
  assert.equal((await logout(new NextRequest(`${issuer}/oauth/logout`))).status, 303)
})

test('concurrent refresh exchange cannot mint two successors', async () => {
  await code('refresh-race')
  const initial = await (await exchange('refresh-race')).json()
  const results = await Promise.all([refresh(initial.refresh_token), refresh(initial.refresh_token)])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400])
  const rows = await db.execute('SELECT COUNT(*) AS n FROM "OAuth2RefreshToken"')
  assert.equal(Number(rows.rows[0].n), 2)
})

test('Basic authentication supports form-encoded credentials and rejects mixed methods', async () => {
  await code('basic')
  const body = { grant_type: 'authorization_code', code: 'basic', redirect_uri: redirectUri, code_verifier: verifier }
  const header = { authorization: `Basic ${Buffer.from('client:secret').toString('base64')}` }
  assert.equal((await token(request('/oauth/token', { ...body, client_secret: 'secret' }, header))).status, 400)
  assert.equal((await token(request('/oauth/token', body, header))).status, 200)
})

test('public client completes authorization with PKCE and without a secret', async () => {
  await store.insertAuthorizationCode({ code: 'public-code', clientId: 'public', userId: 'user', redirectUri,
    scope, expiresAtIso: new Date(Date.now() + 60_000).toISOString(), codeChallenge: challenge,
    codeChallengeMethod: 'S256', nonce: 'public-nonce' })
  const res = await token(request('/oauth/token', { client_id: 'public', grant_type: 'authorization_code',
    code: 'public-code', redirect_uri: redirectUri, code_verifier: verifier }))
  assert.equal(res.status, 200)
})

test('real Auth.js confirmation clears the session cookie and preserves the signed local callback', async () => {
  const { handlers } = await import('../src/auth.ts')
  const { encode } = await import('next-auth/jwt')
  const sessionName = '__Secure-authjs.session-token'
  const sessionToken = await encode({ secret: process.env.NEXTAUTH_SECRET!, salt: sessionName,
    token: { sub: 'user' }, maxAge: 3600 })
  const start = await logout(new NextRequest(`${issuer}/oauth/logout?client_id=client&post_logout_redirect_uri=https%3A%2F%2Frp.example.test%2Flogged-out`))
  const signoutUrl = start.headers.get('location')!
  const confirmation = await handlers.GET(new NextRequest(signoutUrl, {
    headers: { cookie: `${sessionName}=${sessionToken}` },
  }))
  assert.equal(confirmation.status, 200)
  const html = await confirmation.text()
  const csrf = /name="csrfToken" value="([^"]+)"/.exec(html)?.[1]
  assert.ok(csrf)
  const cookies = [`${sessionName}=${sessionToken}`, ...confirmation.headers.getSetCookie().map(c => c.split(';')[0])].join('; ')
  const signedOut = await handlers.POST(request('/api/auth/signout', { csrfToken: csrf }, { cookie: cookies }))
  assert.equal(signedOut.status, 302)
  assert.equal(signedOut.headers.get('location'), new URL(signoutUrl).searchParams.get('callbackUrl'))
  assert.ok(signedOut.headers.getSetCookie().some(c => c.startsWith(`${sessionName}=`) && c.includes('Max-Age=0')))
})

test('failed replacement insert rolls back consumption of the old refresh token', async () => {
  await store.insertRefreshTokenRow({ plainToken: 'old', clientId: 'client', userId: 'user', scope,
    expiresAtIso: new Date(Date.now() + 60_000).toISOString() })
  await store.insertRefreshTokenRow({ plainToken: 'duplicate', clientId: 'client', userId: 'user', scope,
    expiresAtIso: new Date(Date.now() + 60_000).toISOString() })
  await assert.rejects(store.takeRefreshTokenForRotation('old', 'client', { plainToken: 'duplicate', scope }))
  assert.ok(await store.lookupRefreshTokenActive('old'))
})


test('introspection authenticates clients and treats disabled users as inactive', async () => {
  await code('introspection')
  const issued = await (await exchange('introspection')).json()
  assert.equal((await introspect(request('/oauth/introspect', { client_id: 'public', token: issued.access_token }))).status, 401)
  assert.equal((await (await introspect(request('/oauth/introspect', { ...auth, token: issued.access_token }))).json()).active, true)
  try {
    await db.execute(`UPDATE "User" SET "status" = 0 WHERE id = 'user'`)
    for (const value of [issued.access_token, issued.refresh_token]) {
      assert.equal((await (await introspect(request('/oauth/introspect', { ...auth, token: value }))).json()).active, false)
    }
  } finally {
    await db.execute(`UPDATE "User" SET "status" = 1 WHERE id = 'user'`)
  }
})

test('revocation of an ancestor revokes successors and access-token revocation is explicit', async () => {
  await code('revoke-family')
  const issued = await (await exchange('revoke-family')).json()
  const next = await (await refresh(issued.refresh_token)).json()
  assert.equal((await revoke(request('/oauth/revoke', { ...auth, token: issued.refresh_token }))).status, 200)
  assert.equal(await store.lookupRefreshTokenActive(next.refresh_token), null)
  const unsupported = await revoke(request('/oauth/revoke', { ...auth, token: issued.access_token, token_type_hint: 'access_token' }))
  assert.equal(unsupported.status, 400)
  assert.equal((await unsupported.json()).error, 'unsupported_token_type')
})

test('l2cl Better Auth: discovery, PKCE callback, session, refresh and RP logout', {
  skip: !process.env.L2CL_PATH,
}, async () => {
  const { createRequire } = await import('node:module')
  const { resolve } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const l2cl = resolve(process.env.L2CL_PATH!)
  const requireL2cl = createRequire(join(l2cl, 'package.json'))
  const { betterAuth } = await import(pathToFileURL(requireL2cl.resolve('better-auth')).href)
  const { genericOAuth } = await import(pathToFileURL(requireL2cl.resolve('better-auth/plugins')).href)
  const { memoryAdapter } = await import(pathToFileURL(requireL2cl.resolve('better-auth/adapters/memory')).href)
  const { getRbacOAuthConfig } = await import(pathToFileURL(join(l2cl, 'lib/rbac-oauth.ts')).href)
  const rp = 'https://rp.example.test'
  const config = getRbacOAuthConfig({ RBAC_ISSUER_URL: issuer, RBAC_CLIENT_ID: 'client',
    RBAC_CLIENT_SECRET: 'secret', BETTER_AUTH_URL: rp })
  const database: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] }
  const calls: string[] = []
  const transport = mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    assert.equal(url.origin, issuer, 'integration test must not contact external services')
    calls.push(url.pathname)
    if (url.pathname === '/.well-known/openid-configuration') return discovery()
    if (url.pathname === '/.well-known/jwks.json') return Response.json(await jwt.getOAuthJwks())
    if (url.pathname === '/oauth/token') return token(new NextRequest(req))
    if (url.pathname === '/oauth/userinfo') return userinfo(new NextRequest(req))
    throw new Error(`Unexpected integration endpoint: ${url.pathname}`)
  })
  try {
    const client = betterAuth({ baseURL: rp, secret: 'isolated-better-auth-integration-secret-32',
      database: memoryAdapter(database), plugins: [genericOAuth({ config: [config] })],
      account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
      trustedOrigins: [rp],
    })
    const cookies = new Map<string, string>()
    const remember = (response: Response) => {
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0]
        const index = pair.indexOf('=')
        cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
    }
    const call = async (path: string, body?: Record<string, unknown>) => {
      const response = await client.handler(new Request(`${rp}/api/auth${path}`, {
        method: body ? 'POST' : 'GET', headers: { origin: rp,
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }))
      remember(response)
      return response
    }
    const start = await call('/sign-in/social', { provider: 'rbac', callbackURL: `${rp}/dashboard` })
    assert.equal(start.status, 200)
    const authorization = new URL((await start.json()).url)
    assert.equal(authorization.origin, issuer)
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
    assert.ok(authorization.searchParams.get('nonce'))
    const form = Object.fromEntries(authorization.searchParams)
    const approval = await consent(request('/api/oauth/consent', { ...form, action: 'approve' }, { origin: issuer }))
    assert.equal(approval.status, 303)
    const callbackURL = new URL(approval.headers.get('location')!)
    const callback = await call(callbackURL.pathname.replace('/api/auth', '') + callbackURL.search)
    assert.equal(callback.status, 302)
    assert.equal(callback.headers.get('location'), `${rp}/dashboard`)
    const signedIn = await (await call('/get-session')).json()
    assert.equal(signedIn.user.email, 'u@example.test')
    assert.equal(signedIn.user.emailVerified, true)
    assert.ok(calls.includes('/.well-known/jwks.json'))
    assert.equal(database.account[0].providerId, 'rbac')
    const oldRefresh = database.account[0].refreshToken
    const refreshed = await call('/refresh-token', { accountId: database.account[0].id })
    assert.equal(refreshed.status, 200, refreshed.status !== 200 ? await refreshed.text() : undefined)
    assert.notEqual(database.account[0].refreshToken, oldRefresh)
    const signedOut = await call('/sign-out', { callbackURL: `${rp}/logged-out`, disableRedirect: true, state: 'from-better-auth' })
    const logoutURL = (await signedOut.json()).url
    assert.ok(logoutURL)
    assert.equal(new URL(logoutURL).pathname, '/oauth/logout')
    const providerLogout = await logout(new NextRequest(logoutURL))
    assert.equal(providerLogout.status, 303)
    const nextAuthLogout = new URL(providerLogout.headers.get('location')!)
    const completion = nextAuthLogout.searchParams.get('callbackUrl')!
    session = null
    const final = await completeLogout(new NextRequest(completion))
    assert.equal(final.headers.get('location'), `${rp}/logged-out?state=from-better-auth`)
    assert.equal(await (await call('/get-session')).json(), null)
  } finally {
    transport.mock.restore()
  }
})
