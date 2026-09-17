import { test, before, after, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { NextRequest } from 'next/server'

let session: { user: { id: string; email: string }; currentTenantId: string | null; mfaPending?: boolean } | null
mock.module('../src/auth.ts', { namedExports: { auth: async () => session } })
const { POST: invite } = await import('../src/app/api/tenants/[tenantId]/invitations/route.ts')
const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
const { POST: transfer, GET: requests } = await import('../src/app/api/tenants/[tenantId]/owner-transfer/route.ts')
const { POST: confirm } = await import('../src/app/api/tenants/[tenantId]/owner-transfer/confirm/route.ts')
const { removeUserFromTenant } = await import('../src/lib/data-access.ts')
const globals = globalThis as unknown as { libsql?: Client }
let db: Client
let directory: string
const context = { params: Promise.resolve({ tenantId: 'tenant_default' }) }
const req = (body: object = {}) => new NextRequest('https://profilehub.test/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const asUser = (id: string, currentTenantId: string | null = 'tenant_default') => {
  session = { user: { id, email: `${id}@example.test` }, currentTenantId }
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profilehub-collaboration-'))
  db = createClient({ url: `file:${join(directory, 'test.db')}` }); globals.libsql = db
  await db.executeMultiple(await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8'))
  await db.execute(`INSERT INTO "Tenant" (id,name,slug) VALUES ('other','Other','other')`)
  for (const id of ['owner', 'recipient', 'member', 'outsider', 'newcomer']) {
    await db.execute({ sql: 'INSERT INTO "User" (id,name,email) VALUES (?,?,?)', args: [id, id, `${id}@example.test`] })
  }
})
beforeEach(async () => {
  process.env.ENFORCE_RBAC_ON_WRITE = 'false'
  process.env.FEATURE_INVITES = 'true'
  process.env.FEATURE_OWNER_TRANSFER = 'true'
  await db.execute('DELETE FROM "OwnerTransferRequest"')
  await db.execute('DELETE FROM "Invitation"')
  await db.execute('DELETE FROM "UserTenant"')
  for (const id of ['owner', 'recipient', 'member']) {
    await db.execute({ sql: 'INSERT INTO "UserTenant" ("userId","tenantId","tenantRole") VALUES (?,?,?)', args: [id, 'tenant_default', id === 'owner' ? 'owner' : 'member'] })
  }
  asUser('owner')
})
after(async () => { db?.close(); delete globals.libsql; if (directory) await rm(directory, { recursive: true, force: true }) })

test('invitation can be accepted without an existing organization and is email-bound and single-use', async () => {
  const created = await invite(req({ email: 'newcomer@example.test' }), context)
  assert.equal(created.status, 200)
  const { token } = await created.json()
  asUser('outsider', null)
  assert.equal((await accept(req({ token }))).status, 403)
  asUser('newcomer', null)
  const accepted = await accept(req({ token }))
  assert.equal(accepted.status, 200)
  assert.equal((await accepted.json()).tenantId, 'tenant_default')
  assert.equal((await accept(req({ token }))).status, 400)
})

test('ownership request is visible only to owner and recipient, and only recipient can confirm', async () => {
  const result = await transfer(req({ toUserId: 'recipient' }), context)
  assert.equal(result.status, 200)
  const { requestId } = await result.json()
  assert.equal((await (await requests(req(), context)).json()).requests.length, 1)
  asUser('member')
  assert.equal((await (await requests(req(), context)).json()).requests.length, 0)
  assert.equal((await confirm(req({ requestId }), context)).status, 403)
  asUser('recipient')
  assert.equal((await (await requests(req(), context)).json()).requests.length, 1)
  assert.equal((await confirm(req({ requestId }), context)).status, 200)
  const roles = await db.execute('SELECT "userId","tenantRole" FROM "UserTenant" WHERE "tenantId"=\'tenant_default\'')
  assert.equal(roles.rows.find(row => row.userId === 'recipient')?.tenantRole, 'owner')
  assert.equal(roles.rows.find(row => row.userId === 'owner')?.tenantRole, 'admin')
  assert.equal((await confirm(req({ requestId }), context)).status, 400)
})

test('request listing denies cross-organization, non-members, pending MFA, and disabled feature', async () => {
  asUser('owner', 'other'); assert.equal((await requests(req(), context)).status, 403)
  asUser('outsider'); assert.equal((await requests(req(), context)).status, 403)
  asUser('owner'); session!.mfaPending = true; assert.equal((await requests(req(), context)).status, 403)
  asUser('owner'); process.env.FEATURE_OWNER_TRANSFER = 'false'; assert.equal((await requests(req(), context)).status, 404)
})

test('confirming ownership invalidates other pending requests from the old owner', async () => {
  const first = await (await transfer(req({ toUserId: 'recipient' }), context)).json()
  const second = await (await transfer(req({ toUserId: 'member' }), context)).json()
  asUser('recipient')
  assert.equal((await confirm(req({ requestId: first.requestId }), context)).status, 200)
  asUser('member')
  assert.equal((await confirm(req({ requestId: second.requestId }), context)).status, 400)
  const owners = await db.execute(`SELECT "userId" FROM "UserTenant" WHERE "tenantId"='tenant_default' AND "tenantRole"='owner'`)
  assert.deepEqual(owners.rows.map(row => row.userId), ['recipient'])
})

test('member removal retains accounts with other memberships but deletes the last-membership account', async () => {
  await db.execute(`INSERT INTO "UserTenant" ("userId","tenantId","tenantRole") VALUES ('member','other','member')`)
  await removeUserFromTenant('tenant_default', 'member')
  assert.equal((await db.execute(`SELECT id FROM "User" WHERE id='member'`)).rows.length, 1)
  await removeUserFromTenant('other', 'member')
  assert.equal((await db.execute(`SELECT id FROM "User" WHERE id='member'`)).rows.length, 0)
})
