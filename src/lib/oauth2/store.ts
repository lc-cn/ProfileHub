import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getDb, newId, nowIso } from '@/lib/db'
import { verifyPkceS256 } from '@/lib/oauth2/pkce'

export type OAuth2ClientRow = {
  id: string
  applicationId: string
  applicationTenantId: string
  clientId: string
  clientSecretHash: string | null
  name: string
  redirectUrisJson: string
  allowedScopes: string
  logoUrl: string | null
  clientUri: string | null
  policyUri: string | null
  tosUri: string | null
  postLogoutRedirectUrisJson: string
  jwksUri: string | null
  allowedGrantTypes: string
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  authorizationCodeTtlMinutes: number
  createdAt: string
  updatedAt: string
}

function numCol(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint') return Number(v)
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 映射 OAuth2Client 行；同意页/运行时展示名来自 JOIN 的 applicationName（或兼容旧列 name） */
export function mapOAuth2ClientRow(row: Record<string, unknown>): OAuth2ClientRow {
  const applicationId =
    row.applicationId != null && String(row.applicationId).trim() !== ''
      ? String(row.applicationId).trim()
      : String(row.id).trim()
  const nameFromJoin =
    row.applicationName != null && String(row.applicationName).trim() !== ''
      ? String(row.applicationName).trim()
      : String(row.name ?? '').trim()
  return {
    id: String(row.id),
    applicationId,
    applicationTenantId:
      row.applicationTenantId != null && String(row.applicationTenantId).trim() !== ''
        ? String(row.applicationTenantId).trim()
        : '',
    clientId: String(row.clientId),
    clientSecretHash: row.clientSecretHash == null ? null : String(row.clientSecretHash),
    name: nameFromJoin || '(应用)',
    redirectUrisJson: String(row.redirectUrisJson),
    allowedScopes: String(row.allowedScopes),
    logoUrl: row.logoUrl == null || String(row.logoUrl).trim() === '' ? null : String(row.logoUrl).trim(),
    clientUri: row.clientUri == null || String(row.clientUri).trim() === '' ? null : String(row.clientUri).trim(),
    policyUri: row.policyUri == null || String(row.policyUri).trim() === '' ? null : String(row.policyUri).trim(),
    tosUri: row.tosUri == null || String(row.tosUri).trim() === '' ? null : String(row.tosUri).trim(),
    postLogoutRedirectUrisJson:
      row.postLogoutRedirectUrisJson == null || String(row.postLogoutRedirectUrisJson).trim() === ''
        ? '[]'
        : String(row.postLogoutRedirectUrisJson),
    jwksUri: row.jwksUri == null || String(row.jwksUri).trim() === '' ? null : String(row.jwksUri).trim(),
    allowedGrantTypes:
      row.allowedGrantTypes == null || String(row.allowedGrantTypes).trim() === ''
        ? 'authorization_code,refresh_token'
        : String(row.allowedGrantTypes).trim(),
    accessTokenTtlSeconds: numCol(row.accessTokenTtlSeconds, 3600),
    refreshTokenTtlDays: numCol(row.refreshTokenTtlDays, 30),
    authorizationCodeTtlMinutes: numCol(row.authorizationCodeTtlMinutes, 10),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export function parseGrantTypesCsv(s: string | null | undefined): Set<string> {
  const raw = (s && s.trim()) || 'authorization_code,refresh_token'
  return new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))
}

export function clientAllowsGrant(row: OAuth2ClientRow, grant: 'authorization_code' | 'refresh_token'): boolean {
  const g = parseGrantTypesCsv(row.allowedGrantTypes)
  if (g.size === 0) return grant === 'authorization_code'
  return g.has(grant)
}

export function clampAccessTokenTtlSeconds(row: OAuth2ClientRow): number {
  return Math.min(86400, Math.max(300, Math.floor(numCol(row.accessTokenTtlSeconds, 3600))))
}

export function clampRefreshTokenTtlDays(row: OAuth2ClientRow): number {
  return Math.min(365, Math.max(1, Math.floor(numCol(row.refreshTokenTtlDays, 30))))
}

export function clampAuthorizationCodeTtlMinutes(row: OAuth2ClientRow): number {
  return Math.min(60, Math.max(1, Math.floor(numCol(row.authorizationCodeTtlMinutes, 10))))
}

export function parseRedirectUris(json: string): string[] {
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function redirectUriAllowed(redirectUri: string, uris: string[]): boolean {
  return uris.some((u) => u === redirectUri)
}

export async function getOAuth2ClientByClientId(clientId: string): Promise<OAuth2ClientRow | null> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT o.*, a."name" AS "applicationName", a."tenantId" AS "applicationTenantId"
          FROM "OAuth2Client" o
          INNER JOIN "Application" a ON a."id" = o."applicationId"
          WHERE o."clientId" = ?`,
    args: [clientId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  return mapOAuth2ClientRow(row)
}

export function verifyClientSecret(row: OAuth2ClientRow, plainSecret: string | null): boolean {
  if (!row.clientSecretHash) return false
  if (!plainSecret) return false
  return bcrypt.compareSync(plainSecret, row.clientSecretHash)
}

export function isPublicClient(row: OAuth2ClientRow): boolean {
  return row.clientSecretHash == null || row.clientSecretHash === ''
}

export function scopesAllowed(requested: string, allowed: string): boolean {
  const req = requested.split(/\s+/).filter(Boolean)
  const allow = new Set(allowed.split(/\s+/).filter(Boolean))
  return req.every((s) => allow.has(s))
}

export async function insertAuthorizationCode(params: {
  code: string
  clientId: string
  userId: string
  redirectUri: string
  scope: string
  expiresAtIso: string
  codeChallenge: string | null
  codeChallengeMethod: string | null
  nonce: string | null
}) {
  const db = getDb()
  const id = newId()
  await db.execute({
    sql: `INSERT INTO "OAuth2AuthorizationCode" ("id","code","clientId","userId","redirectUri","scope","expiresAt","codeChallenge","codeChallengeMethod","nonce")
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      params.code,
      params.clientId,
      params.userId,
      params.redirectUri,
      params.scope,
      params.expiresAtIso,
      params.codeChallenge,
      params.codeChallengeMethod,
      params.nonce,
    ],
  })
}

export type ConsumedCode = {
  clientId: string
  userId: string
  redirectUri: string
  scope: string
  codeChallenge: string | null
  codeChallengeMethod: string | null
  nonce: string | null
}

export async function consumeAuthorizationCode(code: string, binding: {
  clientId: string; redirectUri: string; codeVerifier: string | null; requirePkce: boolean
}): Promise<ConsumedCode | null> {
  const db = getDb()
  const now = nowIso()
  const sel = await db.execute({
    sql: `SELECT * FROM "OAuth2AuthorizationCode" WHERE "code" = ? AND "expiresAt" > ?
          AND "clientId" = ? AND "redirectUri" = ?`,
    args: [code, now, binding.clientId, binding.redirectUri],
  })
  const row = sel.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  if (binding.requirePkce || row.codeChallenge != null) {
    if (row.codeChallengeMethod !== 'S256' || !binding.codeVerifier ||
        !verifyPkceS256(binding.codeVerifier, String(row.codeChallenge))) return null
  }
  // DELETE ... RETURNING elects exactly one winner, even across server instances.
  const deleted = await db.execute({
    sql: `DELETE FROM "OAuth2AuthorizationCode" WHERE "id" = ? AND "expiresAt" > ? RETURNING "id"`,
    args: [String(row.id), nowIso()],
  })
  if (!deleted.rows.length) return null
  return {
    clientId: String(row.clientId),
    userId: String(row.userId),
    redirectUri: String(row.redirectUri),
    scope: String(row.scope),
    codeChallenge: row.codeChallenge == null ? null : String(row.codeChallenge),
    codeChallengeMethod: row.codeChallengeMethod == null ? null : String(row.codeChallengeMethod),
    nonce: row.nonce == null ? null : String(row.nonce),
  }
}

export function hashOpaqueToken(plain: string): string {
  return createHash('sha256').update(plain).digest('base64url')
}

export function newRefreshTokenPlain(): string {
  return randomBytes(48).toString('base64url')
}

export async function insertRefreshTokenRow(params: {
  plainToken: string
  clientId: string
  userId: string
  scope: string
  expiresAtIso: string
}) {
  const db = getDb()
  const id = newId()
  const tokenHash = hashOpaqueToken(params.plainToken)
  await db.execute({
    sql: `INSERT INTO "OAuth2RefreshToken" ("id","tokenHash","clientId","userId","scope","expiresAt")
          VALUES (?,?,?,?,?,?)`,
    args: [id, tokenHash, params.clientId, params.userId, params.scope, params.expiresAtIso],
  })
}

export type ActiveRefreshRow = {
  id: string
  clientId: string
  userId: string
  scope: string
  expiresAt: string
}

/** 查找未吊销且未过期的刷新令牌（introspection，不修改行） */
export async function lookupRefreshTokenActive(plainToken: string): Promise<ActiveRefreshRow | null> {
  const db = getDb()
  const now = nowIso()
  const tokenHash = hashOpaqueToken(plainToken)
  const sel = await db.execute({
    sql: `SELECT "id","clientId","userId","scope","expiresAt" FROM "OAuth2RefreshToken"
          WHERE "tokenHash" = ? AND "expiresAt" > ? AND "revokedAt" IS NULL`,
    args: [tokenHash, now],
  })
  const row = sel.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: String(row.id),
    clientId: String(row.clientId),
    userId: String(row.userId),
    scope: String(row.scope),
    expiresAt: String(row.expiresAt),
  }
}

/** 消费刷新令牌：标记吊销并返回行数据（用于 refresh_token 轮换） */
export async function takeRefreshTokenForRotation(
  plainToken: string, clientId: string, replacement: { plainToken: string; scope: string }
): Promise<ActiveRefreshRow | null> {
  const db = getDb()
  const tx = await db.transaction('write')
  try {
    const now = nowIso()
    const tokenHash = hashOpaqueToken(plainToken)
    const sel = await tx.execute({
      sql: `SELECT "id","clientId","userId","scope","expiresAt" FROM "OAuth2RefreshToken"
            WHERE "tokenHash" = ? AND "clientId" = ? AND "expiresAt" > ? AND "revokedAt" IS NULL`,
      args: [tokenHash, clientId, now],
    })
    const row = sel.rows[0] as unknown as Record<string, unknown> | undefined
    if (!row) {
      // Reuse of an already rotated token revokes its descendants, not another client's tokens.
      await tx.execute({
        sql: `WITH RECURSIVE family(id) AS (
          SELECT "replacedById" FROM "OAuth2RefreshToken" WHERE "tokenHash" = ? AND "clientId" = ?
          UNION SELECT r."replacedById" FROM "OAuth2RefreshToken" r JOIN family f ON r."id" = f.id
        ) UPDATE "OAuth2RefreshToken" SET "revokedAt" = COALESCE("revokedAt", ?)
          WHERE "id" IN (SELECT id FROM family) AND "clientId" = ?`,
        args: [tokenHash, clientId, now, clientId],
      })
      await tx.commit()
      return null
    }
    if (!scopesAllowed(replacement.scope, String(row.scope))) return null
    const id = String(row.id)
    const replacementId = newId()
    await tx.execute({
      sql: `UPDATE "OAuth2RefreshToken" SET "revokedAt" = ?, "replacedById" = ? WHERE "id" = ?`,
      args: [now, replacementId, id],
    })
    await tx.execute({
      sql: `INSERT INTO "OAuth2RefreshToken" ("id","tokenHash","clientId","userId","scope","expiresAt")
            VALUES (?,?,?,?,?,?)`,
      args: [replacementId, hashOpaqueToken(replacement.plainToken), clientId, String(row.userId),
        replacement.scope, String(row.expiresAt)],
    })
    await tx.commit()
    return {
      id,
      clientId: String(row.clientId),
      userId: String(row.userId),
      scope: String(row.scope),
      expiresAt: String(row.expiresAt),
    }
  } finally {
    tx.close()
  }
}

/** RFC 7009：吊销刷新令牌（幂等） */
export async function revokeRefreshTokenByPlain(plainToken: string, clientId: string): Promise<boolean> {
  const db = getDb()
  const now = nowIso()
  const tokenHash = hashOpaqueToken(plainToken)
  const result = await db.execute({
    sql: `WITH RECURSIVE family(id) AS (
      SELECT "id" FROM "OAuth2RefreshToken" WHERE "tokenHash" = ? AND "clientId" = ?
      UNION SELECT r."replacedById" FROM "OAuth2RefreshToken" r JOIN family f ON r."id" = f.id
    ) UPDATE "OAuth2RefreshToken" SET "revokedAt" = COALESCE("revokedAt", ?)
      WHERE "id" IN (SELECT id FROM family) AND "clientId" = ?`,
    args: [tokenHash, clientId, now, clientId],
  })
  return result.rowsAffected > 0
}

export async function getUserClaimsForToken(userId: string): Promise<{
  sub: string
  email?: string
  emailVerified: boolean
  name?: string
  picture?: string
} | null> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT "id","email","emailVerified","name","image","avatar" FROM "User" WHERE "id" = ? AND "status" = 1`,
    args: [userId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const image = row.image == null ? null : String(row.image)
  const avatar = row.avatar == null ? null : String(row.avatar)
  return {
    sub: String(row.id),
    email: String(row.email),
    emailVerified: row.emailVerified != null,
    name: String(row.name),
    picture: image || avatar || undefined,
  }
}
