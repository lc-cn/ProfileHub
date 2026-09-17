import { getDb, newId, nowIso, boolFromSql, isUniqueConstraintError } from '@/lib/db'
import { ORGANIZATIONS_CURRENT_MEMBERS_PAGE_SIZE } from '@/lib/organizations-current-members-params'
import { resolveTenantLifecycleDisplay, type TenantLifecycleDisplay } from '@/lib/tenant-lifecycle-display'
import { hashInvitationToken, newInvitationPlainToken } from '@/lib/invitation-token'
import { hashPassword, verifyStoredPassword } from '@/lib/password'

export { isUniqueConstraintError }

/** @libsql/client execute 参数类型 */
type SqlArg = string | number | bigint | boolean | null
type SqlArgs = SqlArg[]

function mapApp(row: Record<string, unknown>) {
  const oid = row.oauthClientId == null ? '' : String(row.oauthClientId).trim()
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    tenantId: String(row.tenantId ?? ''),
    description: row.description == null ? null : String(row.description),
    status: boolFromSql(row.status),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    oauthClientId: oid.length ? oid : null,
  }
}

function mapFeature(row: Record<string, unknown>, application?: ReturnType<typeof mapApp>) {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
    applicationId: String(row.applicationId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    ...(application ? { application } : {}),
  }
}

function mapPermission(row: Record<string, unknown>, feature?: unknown) {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
    featureId: String(row.featureId),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    ...(feature !== undefined ? { feature } : {}),
  }
}

function mapRole(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    tenantId: String(row.tenantId ?? ''),
    description: row.description == null ? null : String(row.description),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function mapUserRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    emailVerified: row.emailVerified == null ? null : String(row.emailVerified),
    image: row.image == null ? null : String(row.image),
    password: row.password == null ? null : String(row.password),
    avatar: row.avatar == null ? null : String(row.avatar),
    status: boolFromSql(row.status),
    isPlatformAdmin: boolFromSql(row.isPlatformAdmin),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export type TenantRole = 'owner' | 'admin' | 'member'

/**
 * Issue #10：写入 JWT 的当前租户声明集合。
 * `currentTenantId` 为 null 时，`tenantRole` / `tenantPermissionCodes` 必须同时为 null，
 * 避免无租户上下文却携带前一租户的 RBAC 权限（与 `isPlatformAdmin` 平台只读语义对齐）。
 */
export type JwtTenantClaims = {
  isPlatformAdmin: boolean
  currentTenantId: string | null
  tenantRole: TenantRole | null
  tenantPermissionCodes: string[] | null
}

export async function resolveJwtTenantClaims(userId: string): Promise<JwtTenantClaims> {
  const db = getDb()
  const ur = await db.execute({
    sql: `SELECT "isPlatformAdmin" FROM "User" WHERE "id" = ?`,
    args: [userId],
  })
  const urow = ur.rows[0] as unknown as Record<string, unknown> | undefined
  const isPlatformAdmin = urow ? boolFromSql(urow.isPlatformAdmin) : false
  const mr = await db.execute({
    sql: `SELECT "tenantId", "tenantRole" FROM "UserTenant" WHERE "userId" = ? ORDER BY "createdAt" ASC`,
    args: [userId],
  })
  const memberships = mr.rows as unknown as Record<string, unknown>[]
  const first = memberships[0]
  if (!first) {
    return {
      isPlatformAdmin,
      currentTenantId: null,
      tenantRole: null,
      tenantPermissionCodes: null,
    }
  }
  const currentTenantId = String(first.tenantId)
  const tr = String(first.tenantRole)
  const tenantRole = tr === 'owner' || tr === 'admin' || tr === 'member' ? tr : null
  const tenantPermissionCodes = await listTenantPermissionCodesForUser(userId, currentTenantId)
  return { isPlatformAdmin, currentTenantId, tenantRole, tenantPermissionCodes }
}

export async function getUserTenantMembership(
  userId: string,
  tenantId: string
): Promise<{ tenantRole: TenantRole } | null> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT "tenantRole" FROM "UserTenant" WHERE "userId" = ? AND "tenantId" = ?`,
    args: [userId, tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const tr = String(row.tenantRole)
  if (tr !== 'owner' && tr !== 'admin' && tr !== 'member') return null
  return { tenantRole: tr }
}

/**
 * 当前用户在指定租户下是否通过任一 `UserRole` 持有该 permission 码（`Role` 与 `RolePermission` 均带 `tenantId` 作用域）。
 */
export async function userHasPermission(
  userId: string,
  tenantId: string,
  permissionCode: string
): Promise<boolean> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT 1 AS "x" FROM "UserRole" ur
          INNER JOIN "Role" r ON r."id" = ur."roleId" AND r."tenantId" = ?
          INNER JOIN "RolePermission" rp ON rp."roleId" = r."id"
          INNER JOIN "Permission" p ON p."id" = rp."permissionId" AND p."code" = ?
          WHERE ur."userId" = ?
          LIMIT 1`,
    args: [tenantId, permissionCode, userId],
  })
  return !!r.rows[0]
}

/**
 * Issue #10：当前用户在租户内通过 `UserRole` 聚合得到的全部 `Permission.code`（去重、按 code 升序）。
 *
 * 与 `userHasPermission` 走同一连结条件（`Role.tenantId` 必须等于目标租户），
 * 用于把"当前租户下生效的权限快照"写入 JWT / session，并在租户切换时刷新。
 */
export async function listTenantPermissionCodesForUser(
  userId: string,
  tenantId: string
): Promise<string[]> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT DISTINCT p."code" AS "code" FROM "UserRole" ur
          INNER JOIN "Role" r ON r."id" = ur."roleId" AND r."tenantId" = ?
          INNER JOIN "RolePermission" rp ON rp."roleId" = r."id"
          INNER JOIN "Permission" p ON p."id" = rp."permissionId"
          WHERE ur."userId" = ?
          ORDER BY p."code" ASC`,
    args: [tenantId, userId],
  })
  return (r.rows as unknown as { code: unknown }[])
    .map((row) => String(row.code))
    .filter((code) => code.length > 0)
}

export async function listTenantsForUser(userId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT t.*, ut."tenantRole" AS "membershipRole"
          FROM "Tenant" t
          INNER JOIN "UserTenant" ut ON ut."tenantId" = t."id"
          WHERE ut."userId" = ?
          ORDER BY t."name" ASC`,
    args: [userId],
  })
  return (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    membershipRole: String(row.membershipRole),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
    suspendedAt: row.suspendedAt == null ? null : String(row.suspendedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }))
}

export async function listTenantsPlatformOverview() {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT t."id", t."name", t."slug", t."createdAt", t."updatedAt",
          t."suspendedAt", t."archivedAt",
          (SELECT COUNT(*) FROM "Application" a WHERE a."tenantId" = t."id") AS "applicationCount",
          (SELECT COUNT(*) FROM "UserTenant" ut WHERE ut."tenantId" = t."id") AS "memberCount"
          FROM "Tenant" t
          ORDER BY t."createdAt" DESC`,
    args: [],
  })
  return (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    suspendedAt: row.suspendedAt == null ? null : String(row.suspendedAt),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
    applicationCount: Number(row.applicationCount ?? 0),
    memberCount: Number(row.memberCount ?? 0),
  }))
}

function slugifyTenantSlug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 63) || `tenant-${newId().slice(0, 8)}`
}

export async function createTenantAsOwner(input: { name: string; slug?: string | null }, ownerUserId: string) {
  const db = getDb()
  const id = newId()
  const slug = slugifyTenantSlug(input.slug?.trim() || input.name)
  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "Tenant" ("id","name","slug","createdAt","updatedAt") VALUES (?,?,?,?,?)`,
    args: [id, input.name.trim(), slug, t, t],
  })
  await db.execute({
    sql: `INSERT INTO "UserTenant" ("userId","tenantId","tenantRole","createdAt") VALUES (?,?,?,?)`,
    args: [ownerUserId, id, 'owner', t],
  })
  const out = await db.execute({ sql: `SELECT * FROM "Tenant" WHERE "id" = ?`, args: [id] })
  const row = out.rows[0] as unknown as Record<string, unknown>
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

async function loadFeaturesWithPermissionsForAppIds(applicationIds: string[]) {
  if (applicationIds.length === 0) return { features: [] as Record<string, unknown>[], permsByFeature: new Map<string, unknown[]>() }
  const db = getDb()
  const placeholders = applicationIds.map(() => '?').join(',')
  const fr = await db.execute({
    sql: `SELECT * FROM "Feature" WHERE "applicationId" IN (${placeholders}) ORDER BY "createdAt" DESC`,
    args: applicationIds,
  })
  const features = fr.rows as unknown as Record<string, unknown>[]
  const featureIds = features.map((f) => String(f.id))
  const permsByFeature = new Map<string, unknown[]>()
  if (featureIds.length === 0) return { features, permsByFeature }
  const ph2 = featureIds.map(() => '?').join(',')
  const pr = await db.execute({
    sql: `SELECT * FROM "Permission" WHERE "featureId" IN (${ph2})`,
    args: featureIds,
  })
  for (const p of pr.rows as unknown as Record<string, unknown>[]) {
    const fid = String(p.featureId)
    if (!permsByFeature.has(fid)) permsByFeature.set(fid, [])
    permsByFeature.get(fid)!.push(mapPermission(p))
  }
  return { features, permsByFeature }
}

export async function listApplications(tenantId: string, search: string) {
  const db = getDb()
  let sql = `SELECT a.*, o."clientId" AS "oauthClientId" FROM "Application" a LEFT JOIN "OAuth2Client" o ON o."applicationId" = a."id" WHERE a."tenantId" = ?`
  const args: SqlArgs = [tenantId]
  if (search) {
    sql += ` AND (a."name" LIKE ? OR a."code" LIKE ?)`
    const p = `%${search.replace(/%/g, '')}%`
    args.push(p, p)
  }
  sql += ` ORDER BY a."createdAt" DESC`
  const r = await db.execute({ sql, args })
  const apps = (r.rows as unknown as Record<string, unknown>[]).map(mapApp)
  const ids = apps.map((a) => a.id)
  const { features, permsByFeature } = await loadFeaturesWithPermissionsForAppIds(ids)
  const featsByApp = new Map<string, ReturnType<typeof mapFeature>[]>()
  for (const f of features) {
    const aid = String(f.applicationId)
    if (!featsByApp.has(aid)) featsByApp.set(aid, [])
    const perms = (permsByFeature.get(String(f.id)) ?? []) as ReturnType<typeof mapPermission>[]
    featsByApp.get(aid)!.push(Object.assign(mapFeature(f), { permissions: perms }))
  }
  return apps.map((a) => ({ ...a, features: featsByApp.get(a.id) ?? [] }))
}

export async function getApplicationById(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT a.*, o."clientId" AS "oauthClientId" FROM "Application" a LEFT JOIN "OAuth2Client" o ON o."applicationId" = a."id" WHERE a."id" = ? AND a."tenantId" = ?`,
    args: [id, tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const app = mapApp(row)
  const { features, permsByFeature } = await loadFeaturesWithPermissionsForAppIds([id])
  const feats = features.map((f) => ({
    ...mapFeature(f),
    permissions: (permsByFeature.get(String(f.id)) ?? []) as ReturnType<typeof mapPermission>[],
  }))
  return { ...app, features: feats }
}

export async function createApplication(input: {
  tenantId: string
  name: string
  code: string
  description?: string | null
  status?: boolean
}) {
  const db = getDb()
  const id = newId()
  const t = nowIso()
  const st = input.status === false ? 0 : 1
  await db.execute({
    sql: `INSERT INTO "Application" ("id","name","code","description","status","tenantId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, input.name, input.code, input.description ?? null, st, input.tenantId, t, t],
  })
  return getApplicationById(id, input.tenantId)
}

export async function updateApplication(
  id: string,
  tenantId: string,
  data: { name: string; code: string; description?: string | null; status?: boolean }
) {
  const db = getDb()
  const t = nowIso()
  const st = data.status === false ? 0 : 1
  await db.execute({
    sql: `UPDATE "Application" SET "name"=?, "code"=?, "description"=?, "status"=?, "updatedAt"=? WHERE "id"=? AND "tenantId"=?`,
    args: [data.name, data.code, data.description ?? null, st, t, id, tenantId],
  })
  return getApplicationById(id, tenantId)
}

export async function deleteApplication(id: string, tenantId: string) {
  const db = getDb()
  await db.execute({ sql: `DELETE FROM "Application" WHERE "id" = ? AND "tenantId" = ?`, args: [id, tenantId] })
}

export async function listFeatures(tenantId: string, search: string, applicationId: string) {
  const db = getDb()
  let sql = `SELECT f.*, a."id" as a_id, a."name" as a_name, a."code" as a_code, a."description" as a_description, a."status" as a_status, a."tenantId" as a_tenantId, a."createdAt" as a_createdAt, a."updatedAt" as a_updatedAt
              FROM "Feature" f JOIN "Application" a ON a."id" = f."applicationId"`
  const args: SqlArgs = []
  const cond: string[] = [`a."tenantId" = ?`]
  args.push(tenantId)
  if (applicationId) {
    cond.push(`f."applicationId" = ?`)
    args.push(applicationId)
  }
  if (search) {
    cond.push(`(f."name" LIKE ? OR f."code" LIKE ?)`)
    const p = `%${search.replace(/%/g, '')}%`
    args.push(p, p)
  }
  if (cond.length) sql += ` WHERE ${cond.join(' AND ')}`
  sql += ` ORDER BY f."createdAt" DESC`
  const r = await db.execute({ sql, args })
  const out = []
  for (const row of r.rows as unknown as Record<string, unknown>[]) {
    const application = mapApp({
      id: row.a_id,
      name: row.a_name,
      code: row.a_code,
      description: row.a_description,
      status: row.a_status,
      tenantId: row.a_tenantId,
      createdAt: row.a_createdAt,
      updatedAt: row.a_updatedAt,
    })
    const fid = String(row.id)
    const pr = await db.execute({ sql: `SELECT * FROM "Permission" WHERE "featureId" = ?`, args: [fid] })
    const permissions = (pr.rows as unknown as Record<string, unknown>[]).map((p) => mapPermission(p))
    out.push({ ...mapFeature(row), application, permissions })
  }
  return out
}

export async function getFeatureById(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT f.*, a."id" as a_id, a."name" as a_name, a."code" as a_code, a."description" as a_description, a."status" as a_status, a."tenantId" as a_tenantId, a."createdAt" as a_createdAt, a."updatedAt" as a_updatedAt
          FROM "Feature" f JOIN "Application" a ON a."id" = f."applicationId" WHERE f."id" = ? AND a."tenantId" = ?`,
    args: [id, tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const application = mapApp({
    id: row.a_id,
    name: row.a_name,
    code: row.a_code,
    description: row.a_description,
    status: row.a_status,
    tenantId: row.a_tenantId,
    createdAt: row.a_createdAt,
    updatedAt: row.a_updatedAt,
  })
  const pr = await db.execute({ sql: `SELECT * FROM "Permission" WHERE "featureId" = ?`, args: [id] })
  const permissions = (pr.rows as unknown as Record<string, unknown>[]).map((p) => mapPermission(p))
  return { ...mapFeature(row), application, permissions }
}

export async function createFeature(input: {
  name: string
  code: string
  description?: string | null
  applicationId: string
  tenantId: string
}) {
  const db = getDb()
  const check = await db.execute({
    sql: `SELECT 1 FROM "Application" WHERE "id" = ? AND "tenantId" = ?`,
    args: [input.applicationId, input.tenantId],
  })
  if (!check.rows[0]) return null
  const id = newId()
  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "Feature" ("id","name","code","description","applicationId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
    args: [id, input.name, input.code, input.description ?? null, input.applicationId, t, t],
  })
  return getFeatureById(id, input.tenantId)
}

export async function updateFeature(
  id: string,
  tenantId: string,
  data: { name: string; code: string; description?: string | null; applicationId: string }
) {
  const db = getDb()
  const check = await db.execute({
    sql: `SELECT 1 FROM "Application" WHERE "id" = ? AND "tenantId" = ?`,
    args: [data.applicationId, tenantId],
  })
  if (!check.rows[0]) return null
  const t = nowIso()
  await db.execute({
    sql: `UPDATE "Feature" SET "name"=?, "code"=?, "description"=?, "applicationId"=?, "updatedAt"=? WHERE "id"=?`,
    args: [data.name, data.code, data.description ?? null, data.applicationId, t, id],
  })
  return getFeatureById(id, tenantId)
}

export async function deleteFeature(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT f."id" FROM "Feature" f JOIN "Application" a ON a."id" = f."applicationId" WHERE f."id" = ? AND a."tenantId" = ?`,
    args: [id, tenantId],
  })
  if (!r.rows[0]) return
  await db.execute({ sql: `DELETE FROM "Feature" WHERE "id" = ?`, args: [id] })
}

export async function listPermissions(tenantId: string, search: string, featureId: string) {
  const db = getDb()
  let sql = `SELECT p.*, f."id" as f_id, f."name" as f_name, f."code" as f_code, f."description" as f_description, f."applicationId" as f_applicationId, f."createdAt" as f_createdAt, f."updatedAt" as f_updatedAt,
              a."id" as app_id, a."name" as app_name, a."code" as app_code, a."description" as app_description, a."status" as app_status, a."tenantId" as app_tenantId, a."createdAt" as app_createdAt, a."updatedAt" as app_updatedAt
              FROM "Permission" p
              JOIN "Feature" f ON f."id" = p."featureId"
              JOIN "Application" a ON a."id" = f."applicationId"
              WHERE a."tenantId" = ?`
  const args: SqlArgs = [tenantId]
  const cond: string[] = []
  if (featureId) {
    cond.push(`p."featureId" = ?`)
    args.push(featureId)
  }
  if (search) {
    cond.push(`(p."name" LIKE ? OR p."code" LIKE ?)`)
    const p = `%${search.replace(/%/g, '')}%`
    args.push(p, p)
  }
  if (cond.length) sql += ` AND ${cond.join(' AND ')}`
  sql += ` ORDER BY p."createdAt" DESC`
  const r = await db.execute({ sql, args })
  return (r.rows as unknown as Record<string, unknown>[]).map((row) => {
    const feature = mapFeature(
      {
        id: row.f_id,
        name: row.f_name,
        code: row.f_code,
        description: row.f_description,
        applicationId: row.f_applicationId,
        createdAt: row.f_createdAt,
        updatedAt: row.f_updatedAt,
      },
      mapApp({
        id: row.app_id,
        name: row.app_name,
        code: row.app_code,
        description: row.app_description,
        status: row.app_status,
        tenantId: row.app_tenantId,
        createdAt: row.app_createdAt,
        updatedAt: row.app_updatedAt,
      })
    )
    return mapPermission(row, feature)
  })
}

export async function getPermissionById(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT p.*, f."id" as f_id, f."name" as f_name, f."code" as f_code, f."description" as f_description, f."applicationId" as f_applicationId, f."createdAt" as f_createdAt, f."updatedAt" as f_updatedAt,
              a."id" as app_id, a."name" as app_name, a."code" as app_code, a."description" as app_description, a."status" as app_status, a."tenantId" as app_tenantId, a."createdAt" as app_createdAt, a."updatedAt" as app_updatedAt
              FROM "Permission" p
              JOIN "Feature" f ON f."id" = p."featureId"
              JOIN "Application" a ON a."id" = f."applicationId"
              WHERE p."id" = ? AND a."tenantId" = ?`,
    args: [id, tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const feature = mapFeature(
    {
      id: row.f_id,
      name: row.f_name,
      code: row.f_code,
      description: row.f_description,
      applicationId: row.f_applicationId,
      createdAt: row.f_createdAt,
      updatedAt: row.f_updatedAt,
    },
    mapApp({
      id: row.app_id,
      name: row.app_name,
      code: row.app_code,
      description: row.app_description,
      status: row.app_status,
      tenantId: row.app_tenantId,
      createdAt: row.app_createdAt,
      updatedAt: row.app_updatedAt,
    })
  )
  return mapPermission(row, feature)
}

export async function createPermission(input: {
  tenantId: string
  name: string
  code: string
  description?: string | null
  featureId: string
}) {
  const db = getDb()
  const ok = await db.execute({
    sql: `SELECT 1 FROM "Feature" f JOIN "Application" a ON a."id" = f."applicationId" WHERE f."id" = ? AND a."tenantId" = ?`,
    args: [input.featureId, input.tenantId],
  })
  if (!ok.rows[0]) return null
  const id = newId()
  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "Permission" ("id","name","code","description","featureId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
    args: [id, input.name, input.code, input.description ?? null, input.featureId, t, t],
  })
  return getPermissionById(id, input.tenantId)
}

export async function updatePermission(
  id: string,
  tenantId: string,
  data: { name: string; code: string; description?: string | null; featureId: string }
) {
  const db = getDb()
  const ok = await db.execute({
    sql: `SELECT 1 FROM "Feature" f JOIN "Application" a ON a."id" = f."applicationId" WHERE f."id" = ? AND a."tenantId" = ?`,
    args: [data.featureId, tenantId],
  })
  if (!ok.rows[0]) return null
  const t = nowIso()
  await db.execute({
    sql: `UPDATE "Permission" SET "name"=?, "code"=?, "description"=?, "featureId"=?, "updatedAt"=? WHERE "id"=?`,
    args: [data.name, data.code, data.description ?? null, data.featureId, t, id],
  })
  return getPermissionById(id, tenantId)
}

export async function deletePermission(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT p."id" FROM "Permission" p
          JOIN "Feature" f ON f."id" = p."featureId"
          JOIN "Application" a ON a."id" = f."applicationId"
          WHERE p."id" = ? AND a."tenantId" = ?`,
    args: [id, tenantId],
  })
  if (!r.rows[0]) return
  await db.execute({ sql: `DELETE FROM "Permission" WHERE "id" = ?`, args: [id] })
}

async function attachRoleRelations(roles: ReturnType<typeof mapRole>[]) {
  const db = getDb()
  const ids = roles.map((r) => r.id)
  if (!ids.length) return roles.map((r) => ({ ...r, users: [] as unknown[], permissions: [] as unknown[] }))
  const ph = ids.map(() => '?').join(',')
  const ur = await db.execute({
    sql: `SELECT ur.*, u."id" as u_id, u."name" as u_name, u."email" as u_email, u."emailVerified" as u_emailVerified, u."image" as u_image, u."password" as u_password, u."avatar" as u_avatar, u."status" as u_status, u."createdAt" as u_createdAt, u."updatedAt" as u_updatedAt
          FROM "UserRole" ur JOIN "User" u ON u."id" = ur."userId" WHERE ur."roleId" IN (${ph})`,
    args: ids,
  })
  const rp = await db.execute({
    sql: `SELECT rp.*, p."id" as p_id, p."name" as p_name, p."code" as p_code, p."description" as p_description, p."featureId" as p_featureId, p."createdAt" as p_createdAt, p."updatedAt" as p_updatedAt
          FROM "RolePermission" rp JOIN "Permission" p ON p."id" = rp."permissionId" WHERE rp."roleId" IN (${ph})`,
    args: ids,
  })
  const usersByRole = new Map<string, unknown[]>()
  for (const row of ur.rows as unknown as Record<string, unknown>[]) {
    const rid = String(row.roleId)
    if (!usersByRole.has(rid)) usersByRole.set(rid, [])
    usersByRole.get(rid)!.push({
      userId: String(row.userId),
      roleId: String(row.roleId),
      createdAt: String(row.createdAt),
      user: mapUserRow({
        id: row.u_id,
        name: row.u_name,
        email: row.u_email,
        emailVerified: row.u_emailVerified,
        image: row.u_image,
        password: row.u_password,
        avatar: row.u_avatar,
        status: row.u_status,
        createdAt: row.u_createdAt,
        updatedAt: row.u_updatedAt,
      }),
    })
  }
  const permsByRole = new Map<string, unknown[]>()
  for (const row of rp.rows as unknown as Record<string, unknown>[]) {
    const rid = String(row.roleId)
    if (!permsByRole.has(rid)) permsByRole.set(rid, [])
    permsByRole.get(rid)!.push({
      roleId: String(row.roleId),
      permissionId: String(row.permissionId),
      createdAt: String(row.createdAt),
      permission: mapPermission({
        id: row.p_id,
        name: row.p_name,
        code: row.p_code,
        description: row.p_description,
        featureId: row.p_featureId,
        createdAt: row.p_createdAt,
        updatedAt: row.p_updatedAt,
      }),
    })
  }
  return roles.map((r) => ({
    ...r,
    users: usersByRole.get(r.id) ?? [],
    permissions: permsByRole.get(r.id) ?? [],
  }))
}

export async function listRoles(tenantId: string, search: string) {
  const db = getDb()
  let sql = `SELECT * FROM "Role" WHERE "tenantId" = ?`
  const args: SqlArgs = [tenantId]
  if (search) {
    sql += ` AND ("name" LIKE ? OR IFNULL("description",'') LIKE ?)`
    const p = `%${search.replace(/%/g, '')}%`
    args.push(p, p)
  }
  sql += ` ORDER BY "createdAt" DESC`
  const r = await db.execute({ sql, args })
  const roles = (r.rows as unknown as Record<string, unknown>[]).map(mapRole)
  return attachRoleRelations(roles)
}

export async function getRoleById(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT * FROM "Role" WHERE "id" = ? AND "tenantId" = ?`,
    args: [id, tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const [full] = await attachRoleRelations([mapRole(row)])
  return full
}

export async function createRole(input: {
  tenantId: string
  name: string
  description?: string | null
  permissionIds?: string[]
}) {
  const db = getDb()
  const id = newId()
  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "Role" ("id","name","description","tenantId","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`,
    args: [id, input.name, input.description ?? null, input.tenantId, t, t],
  })
  if (input.permissionIds?.length) {
    for (const pid of input.permissionIds) {
      const ok = await getPermissionById(pid, input.tenantId)
      if (!ok) continue
      await db.execute({
        sql: `INSERT INTO "RolePermission" ("roleId","permissionId","createdAt") VALUES (?,?,?)`,
        args: [id, pid, t],
      })
    }
  }
  return getRoleById(id, input.tenantId)
}

export async function updateRole(
  id: string,
  tenantId: string,
  data: { name: string; description?: string | null; permissionIds?: string[] }
) {
  const db = getDb()
  const existing = await db.execute({
    sql: `SELECT 1 FROM "Role" WHERE "id" = ? AND "tenantId" = ?`,
    args: [id, tenantId],
  })
  if (!existing.rows[0]) return null
  const t = nowIso()
  await db.execute({
    sql: `UPDATE "Role" SET "name"=?, "description"=?, "updatedAt"=? WHERE "id"=? AND "tenantId"=?`,
    args: [data.name, data.description ?? null, t, id, tenantId],
  })
  await db.execute({ sql: `DELETE FROM "RolePermission" WHERE "roleId" = ?`, args: [id] })
  if (data.permissionIds?.length) {
    for (const pid of data.permissionIds) {
      const ok = await getPermissionById(pid, tenantId)
      if (!ok) continue
      await db.execute({
        sql: `INSERT INTO "RolePermission" ("roleId","permissionId","createdAt") VALUES (?,?,?)`,
        args: [id, pid, t],
      })
    }
  }
  return getRoleById(id, tenantId)
}

export async function deleteRole(id: string, tenantId: string) {
  const db = getDb()
  await db.execute({
    sql: `DELETE FROM "Role" WHERE "id" = ? AND "tenantId" = ?`,
    args: [id, tenantId],
  })
}

function parseMembershipTenantRole(row: Record<string, unknown>): TenantRole | null {
  const raw = row.membershipTenantRole
  if (raw == null) return null
  const tr = String(raw)
  if (tr === 'owner' || tr === 'admin' || tr === 'member') return tr
  return null
}

function mapUserRowWithTenantMembership(row: Record<string, unknown>) {
  const tenantRole = parseMembershipTenantRole(row)
  const u = mapUserRow(row)
  return { ...u, tenantRole }
}

/** 返回用户在租户下的 tenantRole；非成员为 null */
export async function getUserTenantRole(userId: string, tenantId: string): Promise<TenantRole | null> {
  const m = await getUserTenantMembership(userId, tenantId)
  return m?.tenantRole ?? null
}

/**
 * 将非 owner 成员的租户治理角色设为 admin 或 member（第一波不支持 owner 行变更）。
 */
export async function setUserTenantGovernanceRole(
  tenantId: string,
  userId: string,
  nextRole: 'admin' | 'member'
): Promise<'ok' | 'not_found' | 'target_is_owner'> {
  const db = getDb()
  const cur = await db.execute({
    sql: `SELECT "tenantRole" FROM "UserTenant" WHERE "userId" = ? AND "tenantId" = ?`,
    args: [userId, tenantId],
  })
  const row = cur.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return 'not_found'
  const tr = String(row.tenantRole)
  if (tr === 'owner') return 'target_is_owner'
  await db.execute({
    sql: `UPDATE "UserTenant" SET "tenantRole" = ? WHERE "userId" = ? AND "tenantId" = ?`,
    args: [nextRole, userId, tenantId],
  })
  return 'ok'
}

async function attachUserRoles(
  users: (ReturnType<typeof mapUserRow> & { tenantRole: TenantRole | null })[],
  tenantId: string
) {
  const db = getDb()
  const ids = users.map((u) => u.id)
  if (!ids.length) return users.map((u) => ({ ...u, roles: [] as unknown[] }))
  const ph = ids.map(() => '?').join(',')
  const rr = await db.execute({
    sql: `SELECT ur.*, r."id" as r_id, r."name" as r_name, r."description" as r_description, r."tenantId" as r_tenantId, r."createdAt" as r_createdAt, r."updatedAt" as r_updatedAt
          FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" AND r."tenantId" = ?
          WHERE ur."userId" IN (${ph})`,
    args: [tenantId, ...ids],
  })
  const byUser = new Map<string, unknown[]>()
  for (const row of rr.rows as unknown as Record<string, unknown>[]) {
    const uid = String(row.userId)
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push({
      userId: String(row.userId),
      roleId: String(row.roleId),
      createdAt: String(row.createdAt),
      role: mapRole({
        id: row.r_id,
        name: row.r_name,
        description: row.r_description,
        tenantId: row.r_tenantId,
        createdAt: row.r_createdAt,
        updatedAt: row.r_updatedAt,
      }),
    })
  }
  return users.map((u) => ({ ...u, roles: byUser.get(u.id) ?? [] }))
}

export async function listUsers(tenantId: string, search: string) {
  const db = getDb()
  let sql = `SELECT u.*, ut."tenantRole" AS "membershipTenantRole" FROM "User" u
              INNER JOIN "UserTenant" ut ON ut."userId" = u."id" AND ut."tenantId" = ?`
  const args: SqlArgs = [tenantId]
  if (search) {
    sql += ` WHERE (u."name" LIKE ? OR u."email" LIKE ?)`
    const p = `%${search.replace(/%/g, '')}%`
    args.push(p, p)
  }
  sql += ` ORDER BY u."createdAt" DESC`
  const r = await db.execute({ sql, args })
  const users = (r.rows as unknown as Record<string, unknown>[]).map(mapUserRowWithTenantMembership)
  return attachUserRoles(users, tenantId)
}

export async function getUserById(id: string, tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT u.*, ut."tenantRole" AS "membershipTenantRole" FROM "User" u
          INNER JOIN "UserTenant" ut ON ut."userId" = u."id" AND ut."tenantId" = ?
          WHERE u."id" = ?`,
    args: [tenantId, id],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const [u] = await attachUserRoles([mapUserRowWithTenantMembership(row)], tenantId)
  return u
}

export async function findUserByEmail(email: string) {
  const db = getDb()
  const r = await db.execute({ sql: `SELECT * FROM "User" WHERE "email" = ?`, args: [email] })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  return row ? mapUserRow(row) : null
}

/** 账户级读取（无租户作用域），用于个人资料、改密等 */
export async function getUserByIdGlobal(id: string) {
  const db = getDb()
  const r = await db.execute({ sql: `SELECT * FROM "User" WHERE "id" = ?`, args: [id] })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  return row ? mapUserRow(row) : null
}

export async function createUser(input: {
  tenantId: string
  name: string
  email: string
  password?: string | null
  avatar?: string | null
  status?: boolean
  roleIds?: string[]
}) {
  const db = getDb()
  const id = newId()
  const t = nowIso()
  const st = input.status === false ? 0 : 1
  const rawPw = input.password?.trim()
  const passwordToStore = rawPw ? hashPassword(rawPw) : null
  await db.execute({
    sql: `INSERT INTO "User" ("id","name","email","emailVerified","image","password","avatar","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [id, input.name, input.email, null, null, passwordToStore, input.avatar ?? null, st, t, t],
  })
  await db.execute({
    sql: `INSERT INTO "UserTenant" ("userId","tenantId","tenantRole","createdAt") VALUES (?,?,?,?)`,
    args: [id, input.tenantId, 'member', t],
  })
  if (input.roleIds?.length) {
    for (const rid of input.roleIds) {
      const role = await db.execute({
        sql: `SELECT 1 FROM "Role" WHERE "id" = ? AND "tenantId" = ?`,
        args: [rid, input.tenantId],
      })
      if (!role.rows[0]) continue
      await db.execute({
        sql: `INSERT INTO "UserRole" ("userId","roleId","createdAt") VALUES (?,?,?)`,
        args: [id, rid, t],
      })
    }
  }
  return getUserById(id, input.tenantId)
}

export async function updateUser(
  id: string,
  tenantId: string,
  data: {
    name: string
    email: string
    password?: string | null
    avatar?: string | null
    status?: boolean
    roleIds?: string[]
  }
) {
  const db = getDb()
  const mem = await db.execute({
    sql: `SELECT 1 FROM "UserTenant" WHERE "userId" = ? AND "tenantId" = ?`,
    args: [id, tenantId],
  })
  if (!mem.rows[0]) return null
  const t = nowIso()
  const st = data.status === false ? 0 : 1
  let sql = `UPDATE "User" SET "name"=?, "email"=?, "avatar"=?, "status"=?, "updatedAt"=?`
  const args: SqlArgs = [data.name, data.email, data.avatar ?? null, st, t]
  if (data.password) {
    sql += `, "password"=?`
    args.push(hashPassword(String(data.password)) as SqlArg)
  }
  sql += ` WHERE "id"=?`
  args.push(id)
  await db.execute({ sql, args })
  await db.execute({
    sql: `DELETE FROM "UserRole" WHERE "userId" = ? AND "roleId" IN (SELECT "id" FROM "Role" WHERE "tenantId" = ?)`,
    args: [id, tenantId],
  })
  if (data.roleIds?.length) {
    for (const rid of data.roleIds) {
      const role = await db.execute({
        sql: `SELECT 1 FROM "Role" WHERE "id" = ? AND "tenantId" = ?`,
        args: [rid, tenantId],
      })
      if (!role.rows[0]) continue
      await db.execute({
        sql: `INSERT INTO "UserRole" ("userId","roleId","createdAt") VALUES (?,?,?)`,
        args: [id, rid, t],
      })
    }
  }
  return getUserById(id, tenantId)
}

/** 从当前租户移除成员；若无任何租户归属则删除账号行 */
export async function removeUserFromTenant(tenantId: string, userId: string) {
  const db = getDb()
  await db.execute({
    sql: `DELETE FROM "UserRole" WHERE "userId" = ? AND "roleId" IN (SELECT "id" FROM "Role" WHERE "tenantId" = ?)`,
    args: [userId, tenantId],
  })
  await db.execute({
    sql: `DELETE FROM "UserTenant" WHERE "userId" = ? AND "tenantId" = ?`,
    args: [userId, tenantId],
  })
  const rest = await db.execute({
    sql: `SELECT COUNT(*) as c FROM "UserTenant" WHERE "userId" = ?`,
    args: [userId],
  })
  const n = Number((rest.rows[0] as unknown as { c: number }).c)
  if (n === 0) {
    await db.execute({ sql: `DELETE FROM "User" WHERE "id" = ?`, args: [userId] })
  }
}

/** 完全删除用户（个人注销等） */
export async function deleteUserAccountGlobally(userId: string) {
  const db = getDb()
  await db.execute({ sql: `DELETE FROM "User" WHERE "id" = ?`, args: [userId] })
}

function userHasPasswordSet(user: { password: string | null }) {
  return !!(user.password && user.password.trim())
}

export async function updateUserSelfProfile(
  userId: string,
  data: { name: string; email?: string; image?: string | null; avatar?: string | null }
) {
  const db = getDb()
  const user = await getUserByIdGlobal(userId)
  if (!user) return { error: 'not_found' as const }

  const emailNext = data.email !== undefined ? data.email.trim() : user.email
  if (emailNext !== user.email) {
    const other = await findUserByEmail(emailNext)
    if (other && other.id !== userId) return { error: 'email_taken' as const }
  }

  const image = data.image !== undefined ? data.image : user.image
  const avatar = data.avatar !== undefined ? data.avatar : user.avatar
  const t = nowIso()
  await db.execute({
    sql: `UPDATE "User" SET "name"=?, "email"=?, "image"=?, "avatar"=?, "updatedAt"=? WHERE "id"=?`,
    args: [data.name.trim(), emailNext, image ?? null, avatar ?? null, t, userId],
  })
  return { ok: true as const }
}

export async function changeUserPassword(
  userId: string,
  input: { currentPassword?: string | null; newPassword: string }
) {
  const user = await getUserByIdGlobal(userId)
  if (!user) return { error: 'not_found' as const }
  const hasPw = userHasPasswordSet(user)
  if (hasPw) {
    const cur = input.currentPassword ?? ''
    if (!verifyStoredPassword(user.password, cur)) return { error: 'invalid_current' as const }
  }
  const db = getDb()
  const t = nowIso()
  await db.execute({
    sql: `UPDATE "User" SET "password" = ?, "updatedAt" = ? WHERE "id" = ?`,
    args: [hashPassword(input.newPassword), t, userId],
  })
  return { ok: true as const }
}

export async function verifySelfDeleteAccount(
  userId: string,
  opts: { password?: string; confirmEmail?: string }
): Promise<{ ok: true } | { error: 'not_found' | 'invalid' }> {
  const user = await getUserByIdGlobal(userId)
  if (!user) return { error: 'not_found' }
  const hasPw = userHasPasswordSet(user)
  if (hasPw) {
    if (!opts.password || !verifyStoredPassword(user.password, opts.password)) return { error: 'invalid' }
    return { ok: true }
  }
  const expected = user.email.trim().toLowerCase()
  const got = opts.confirmEmail?.trim().toLowerCase() ?? ''
  if (!got || got !== expected) return { error: 'invalid' }
  return { ok: true }
}

export async function listSystemConfigs() {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT * FROM "SystemConfig" ORDER BY "group" ASC, "key" ASC`,
    args: [],
  })
  return (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    key: String(row.key),
    value: String(row.value),
    group: String(row.group),
    label: row.label == null ? null : String(row.label),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }))
}

export async function upsertSystemConfigRow(input: {
  key: string
  value: string
  group: string
  label: string
}) {
  const db = getDb()
  const t = nowIso()
  const existing = await db.execute({ sql: `SELECT "id" FROM "SystemConfig" WHERE "key" = ?`, args: [input.key] })
  const eid = existing.rows[0] as unknown as { id: string } | undefined
  if (eid) {
    await db.execute({
      sql: `UPDATE "SystemConfig" SET "value"=?, "group"=?, "label"=?, "updatedAt"=? WHERE "key"=?`,
      args: [input.value, input.group, input.label, t, input.key],
    })
    const r = await db.execute({ sql: `SELECT * FROM "SystemConfig" WHERE "key" = ?`, args: [input.key] })
    const row = r.rows[0] as unknown as Record<string, unknown>
    return {
      id: String(row.id),
      key: String(row.key),
      value: String(row.value),
      group: String(row.group),
      label: row.label == null ? null : String(row.label),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    }
  }
  const id = newId()
  await db.execute({
    sql: `INSERT INTO "SystemConfig" ("id","key","value","group","label","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
    args: [id, input.key, input.value, input.group, input.label, t, t],
  })
  const r = await db.execute({ sql: `SELECT * FROM "SystemConfig" WHERE "key" = ?`, args: [input.key] })
  const row = r.rows[0] as unknown as Record<string, unknown>
  return {
    id: String(row.id),
    key: String(row.key),
    value: String(row.value),
    group: String(row.group),
    label: row.label == null ? null : String(row.label),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

export async function dashboardCounts(tenantId: string) {
  const db = getDb()
  const [u, ro, pe, ap] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as c FROM "UserTenant" WHERE "tenantId" = ?`,
      args: [tenantId],
    }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM "Role" WHERE "tenantId" = ?`, args: [tenantId] }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM "Permission" p
            INNER JOIN "Feature" f ON f."id" = p."featureId"
            INNER JOIN "Application" a ON a."id" = f."applicationId"
            WHERE a."tenantId" = ?`,
      args: [tenantId],
    }),
    db.execute({ sql: `SELECT COUNT(*) as c FROM "Application" WHERE "tenantId" = ?`, args: [tenantId] }),
  ])
  return {
    userCount: Number((u.rows[0] as unknown as { c: number }).c),
    roleCount: Number((ro.rows[0] as unknown as { c: number }).c),
    permissionCount: Number((pe.rows[0] as unknown as { c: number }).c),
    appCount: Number((ap.rows[0] as unknown as { c: number }).c),
  }
}

/** 控制台首页等展示的租户名称与 slug */
export async function getTenantDisplay(tenantId: string): Promise<{ name: string; slug: string } | null> {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT "name", "slug" FROM "Tenant" WHERE "id" = ?`,
    args: [tenantId],
  })
  const row = r.rows[0] as unknown as { name: string; slug: string } | undefined
  if (!row) return null
  return { name: String(row.name), slug: String(row.slug) }
}

/** Issue #15：仅当 `UserTenant` 存在时返回当前租户摘要，防止仅凭会话 tenantId 跨租户读取。 */
export type TenantCurrentSummary = {
  name: string
  slug: string
  lifecycle: TenantLifecycleDisplay
}

export async function getTenantCurrentSummaryForMember(
  userId: string,
  tenantId: string
): Promise<TenantCurrentSummary | null> {
  const m = await getUserTenantMembership(userId, tenantId)
  if (!m) return null
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT "name", "slug", "suspendedAt", "archivedAt" FROM "Tenant" WHERE "id" = ?`,
    args: [tenantId],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return null
  const life = {
    suspendedAt: row.suspendedAt == null ? null : String(row.suspendedAt),
    archivedAt: row.archivedAt == null ? null : String(row.archivedAt),
  }
  return {
    name: String(row.name),
    slug: String(row.slug),
    lifecycle: resolveTenantLifecycleDisplay(life),
  }
}

function tenantMemberDirectoryLikeArgs(searchTrimmed: string): SqlArgs {
  const escaped = searchTrimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const p = `%${escaped}%`
  return [p, p]
}

export type TenantMemberDirectoryRow = {
  userId: string
  displayName: string
  email: string
  tenantRole: TenantRole
}

/**
 * Issue #16：当前租户成员只读分页列表（显示名、邮箱、`UserTenant.tenantRole`）。
 * 仅当请求者在该租户存在 `UserTenant` 时返回数据，否则 `null`（与 #15 成员校验一致）。
 */
export async function listTenantMembersForCurrentOrganizationPage(
  requestingUserId: string,
  tenantId: string,
  options: { page: number; search: string }
): Promise<{
  items: TenantMemberDirectoryRow[]
  total: number
  page: number
  pageSize: number
} | null> {
  const membership = await getUserTenantMembership(requestingUserId, tenantId)
  if (!membership) return null

  const pageSize = ORGANIZATIONS_CURRENT_MEMBERS_PAGE_SIZE
  const page =
    Number.isFinite(options.page) && options.page >= 1 ? Math.floor(options.page) : 1
  const search = options.search.trim()
  const searchClause =
    search.length > 0
      ? ` AND (u."name" COLLATE NOCASE LIKE ? ESCAPE '\\' OR u."email" COLLATE NOCASE LIKE ? ESCAPE '\\')`
      : ''
  const searchArgs: SqlArgs = search.length > 0 ? tenantMemberDirectoryLikeArgs(search) : []

  const db = getDb()
  const baseFrom = `FROM "User" u
          INNER JOIN "UserTenant" ut ON ut."userId" = u."id" AND ut."tenantId" = ?`
  const baseArgs: SqlArgs = [tenantId, ...searchArgs]

  const cr = await db.execute({
    sql: `SELECT COUNT(*) AS c ${baseFrom} WHERE 1=1${searchClause}`,
    args: baseArgs,
  })
  const total = Number((cr.rows[0] as unknown as { c: unknown }).c ?? 0)

  const offset = (page - 1) * pageSize
  const lr = await db.execute({
    sql: `SELECT u."id", u."name", u."email", ut."tenantRole" AS "membershipTenantRole" ${baseFrom}
          WHERE 1=1${searchClause}
          ORDER BY u."name" COLLATE NOCASE ASC, u."id" ASC
          LIMIT ? OFFSET ?`,
    args: [...baseArgs, pageSize, offset],
  })

  const items: TenantMemberDirectoryRow[] = (lr.rows as unknown as Record<string, unknown>[]).map((row) => {
    const tr = parseMembershipTenantRole(row)
    const role: TenantRole = tr ?? 'member'
    return {
      userId: String(row.id),
      displayName: String(row.name),
      email: String(row.email),
      tenantRole: role,
    }
  })

  return { items, total, page, pageSize }
}

/** Issue #6：暂停 / 归档（运维或 owner 通过 API 切换）。 */
export async function setTenantLifecycleFields(
  tenantId: string,
  patch: { suspended?: boolean; archived?: boolean }
): Promise<boolean | null> {
  const db = getDb()
  const exists = await db.execute({ sql: `SELECT 1 FROM "Tenant" WHERE "id" = ?`, args: [tenantId] })
  if (!exists.rows[0]) return null
  const t = nowIso()
  const sets: string[] = []
  const args: SqlArgs = []
  if (patch.suspended !== undefined) {
    sets.push(`"suspendedAt" = ?`)
    args.push(patch.suspended ? t : null)
  }
  if (patch.archived !== undefined) {
    sets.push(`"archivedAt" = ?`)
    args.push(patch.archived ? t : null)
  }
  if (!sets.length) return true
  sets.push(`"updatedAt" = ?`)
  args.push(t, tenantId)
  await db.execute({
    sql: `UPDATE "Tenant" SET ${sets.join(', ')} WHERE "id" = ?`,
    args,
  })
  return true
}

export async function createInvitationRecord(input: {
  tenantId: string
  inviterUserId: string
  expiresAtIso: string
  emailConstraint: string | null
}): Promise<{ id: string; plainToken: string }> {
  const plain = newInvitationPlainToken()
  const tokenHash = hashInvitationToken(plain)
  const id = newId()
  const t = nowIso()
  const db = getDb()
  await db.execute({
    sql: `INSERT INTO "Invitation" ("id","tenantId","tokenHash","inviterUserId","expiresAt","targetRole","emailConstraint","createdAt")
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.tenantId,
      tokenHash,
      input.inviterUserId,
      input.expiresAtIso,
      'member',
      input.emailConstraint,
      t,
    ],
  })
  return { id, plainToken: plain }
}

export async function listInvitationsForTenant(tenantId: string) {
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT "id", "expiresAt", "consumedAt", "emailConstraint", "createdAt", "inviterUserId"
          FROM "Invitation" WHERE "tenantId" = ? ORDER BY "createdAt" DESC`,
    args: [tenantId],
  })
  return (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    expiresAt: String(row.expiresAt),
    consumedAt: row.consumedAt == null ? null : String(row.consumedAt),
    emailConstraint: row.emailConstraint == null ? null : String(row.emailConstraint),
    createdAt: String(row.createdAt),
    inviterUserId: String(row.inviterUserId),
  }))
}

export type ConsumeInvitationResult =
  | { ok: true; tenantId: string }
  | {
      ok: false
      code: 'invalid_token' | 'expired' | 'consumed' | 'email_mismatch' | 'tenant_locked' | 'already_member'
    }

export async function consumeInvitationByPlainToken(
  plainToken: string,
  acceptingUserId: string,
  acceptingUserEmail: string
): Promise<ConsumeInvitationResult> {
  const tokenHash = hashInvitationToken(plainToken.trim())
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT i.*, t."archivedAt" AS "tArchived", t."suspendedAt" AS "tSuspended"
          FROM "Invitation" i
          JOIN "Tenant" t ON t."id" = i."tenantId"
          WHERE i."tokenHash" = ?`,
    args: [tokenHash],
  })
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined
  if (!row) return { ok: false, code: 'invalid_token' }
  if (row.consumedAt != null) return { ok: false, code: 'consumed' }
  const exp = String(row.expiresAt)
  if (Date.parse(exp) < Date.now()) return { ok: false, code: 'expired' }
  if (row.tArchived != null || row.tSuspended != null) return { ok: false, code: 'tenant_locked' }

  const emailConstraint =
    row.emailConstraint == null ? null : String(row.emailConstraint).trim().toLowerCase()
  if (emailConstraint && acceptingUserEmail.trim().toLowerCase() !== emailConstraint) {
    return { ok: false, code: 'email_mismatch' }
  }

  const tenantId = String(row.tenantId)
  const existing = await db.execute({
    sql: `SELECT 1 FROM "UserTenant" WHERE "userId" = ? AND "tenantId" = ?`,
    args: [acceptingUserId, tenantId],
  })
  if (existing.rows[0]) return { ok: false, code: 'already_member' }

  const tr = String(row.targetRole)
  const role: TenantRole = tr === 'admin' ? 'admin' : 'member'

  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "UserTenant" ("userId","tenantId","tenantRole","createdAt") VALUES (?,?,?,?)`,
    args: [acceptingUserId, tenantId, role, t],
  })
  await db.execute({
    sql: `UPDATE "Invitation" SET "consumedAt" = ? WHERE "id" = ?`,
    args: [t, String(row.id)],
  })
  return { ok: true, tenantId }
}

export async function createOwnerTransferRequest(
  tenantId: string,
  fromUserId: string,
  toUserId: string,
  expiresAtIso: string
): Promise<{ id: string } | null> {
  const fromM = await getUserTenantMembership(fromUserId, tenantId)
  if (!fromM || fromM.tenantRole !== 'owner') return null
  const toM = await getUserTenantMembership(toUserId, tenantId)
  if (!toM || toM.tenantRole === 'owner') return null
  if (fromUserId === toUserId) return null

  const db = getDb()
  const id = newId()
  const t = nowIso()
  await db.execute({
    sql: `INSERT INTO "OwnerTransferRequest" ("id","tenantId","fromUserId","toUserId","status","expiresAt","createdAt") VALUES (?,?,?,?,?,?,?)`,
    args: [id, tenantId, fromUserId, toUserId, 'pending', expiresAtIso, t],
  })
  return { id }
}

export async function confirmOwnerTransferRequest(
  requestId: string,
  tenantId: string,
  confirmingUserId: string
): Promise<'ok' | 'not_found' | 'not_pending' | 'wrong_user' | 'expired'> {
  const tx = await getDb().transaction('write')
  try {
    const result = await tx.execute({
      sql: `SELECT * FROM "OwnerTransferRequest" WHERE "id" = ? AND "tenantId" = ?`,
      args: [requestId, tenantId],
    })
    const row = result.rows[0]
    if (!row) return 'not_found'
    if (String(row.status) !== 'pending') return 'not_pending'
    if (String(row.toUserId) !== confirmingUserId) return 'wrong_user'
    if (Date.parse(String(row.expiresAt)) <= Date.now()) return 'expired'
    const fromUserId = String(row.fromUserId)
    const toUserId = String(row.toUserId)
    const memberships = await tx.execute({
      sql: `SELECT "userId", "tenantRole" FROM "UserTenant" WHERE "tenantId" = ? AND "userId" IN (?, ?)`,
      args: [tenantId, fromUserId, toUserId],
    })
    if (!memberships.rows.some(m => m.userId === fromUserId && m.tenantRole === 'owner') ||
        !memberships.rows.some(m => m.userId === toUserId && m.tenantRole !== 'owner')) return 'not_pending'
    await tx.execute({
      sql: `UPDATE "UserTenant" SET "tenantRole" = 'admin' WHERE "tenantId" = ? AND "userId" = ?`,
      args: [tenantId, fromUserId],
    })
    await tx.execute({
      sql: `UPDATE "UserTenant" SET "tenantRole" = 'owner' WHERE "tenantId" = ? AND "userId" = ?`,
      args: [tenantId, toUserId],
    })
    await tx.execute({
      sql: `UPDATE "OwnerTransferRequest" SET "status" = 'completed', "completedAt" = ? WHERE "id" = ?`,
      args: [nowIso(), requestId],
    })
    // Requests from the former owner cannot be reused to create another owner.
    await tx.execute({
      sql: `UPDATE "OwnerTransferRequest" SET "status" = 'cancelled' WHERE "tenantId" = ? AND "status" = 'pending'`,
      args: [tenantId],
    })
    await tx.commit()
    return 'ok'
  } finally {
    tx.close()
  }
}

/** Requests visible to the current owner or their intended recipient. */
export async function listOwnerTransfersForMember(tenantId: string, userId: string, isOwner: boolean) {
  const result = await getDb().execute({
    sql: `SELECT r."id", r."toUserId", r."status", r."expiresAt", u."name" AS "recipientName", u."email" AS "recipientEmail"
          FROM "OwnerTransferRequest" r JOIN "User" u ON u."id" = r."toUserId"
          WHERE r."tenantId" = ? AND (? = 1 OR r."toUserId" = ?)
          ORDER BY r."createdAt" DESC LIMIT 50`,
    args: [tenantId, isOwner ? 1 : 0, userId],
  })
  return result.rows.map(row => ({
    id: String(row.id), toUserId: String(row.toUserId), status: String(row.status),
    expiresAt: String(row.expiresAt), recipientName: String(row.recipientName), recipientEmail: String(row.recipientEmail),
  }))
}
