import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createOwnerTransferRequest, listOwnerTransfersForMember } from '@/lib/data-access'
import { governanceForbiddenResponse, requireActorTenantRole } from '@/lib/governance-server'
import { requireTenantId } from '@/lib/tenant-server'
import { featureOwnerTransferEnabled } from '@/lib/wave3-env'

/** owner 发起移交：POST body `{ "toUserId": "<成员用户 id>", "expiresInDays"?: number }` */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    if (!featureOwnerTransferEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { tenantId } = await params
    const session = await auth()
    const tenantRes = requireTenantId(session)
    if (tenantRes instanceof Response) return tenantRes
    if (tenantRes !== tenantId) return NextResponse.json({ error: '租户上下文不一致' }, { status: 403 })

    const actor = await requireActorTenantRole(session, tenantId)
    if (actor instanceof NextResponse) return actor
    if (actor.tenantRole !== 'owner') return governanceForbiddenResponse('forbidden_owner_only')

    const body = (await request.json()) as { toUserId?: unknown; expiresInDays?: unknown }
    const toUserId = typeof body.toUserId === 'string' ? body.toUserId.trim() : ''
    if (!toUserId) return NextResponse.json({ error: '缺少 toUserId' }, { status: 400 })
    let days = 7
    if (typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays)) {
      days = Math.min(30, Math.max(1, Math.floor(body.expiresInDays)))
    }
    const expiresAtIso = new Date(Date.now() + days * 86400000).toISOString()

    const created = await createOwnerTransferRequest(tenantId, actor.userId, toUserId, expiresAtIso)
    if (!created) {
      return NextResponse.json({ error: '无法创建移交请求（检查目标是否为租户内非 owner 成员）' }, { status: 400 })
    }
    return NextResponse.json({ requestId: created.id, expiresAt: expiresAtIso })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }
}

/** List only requests visible to the owner or the current recipient. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  if (!featureOwnerTransferEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { tenantId } = await params
  const session = await auth()
  if (session?.mfaPending) return NextResponse.json({ error: '需要完成多因素验证' }, { status: 403 })
  const tenantRes = requireTenantId(session)
  if (tenantRes instanceof Response) return tenantRes
  if (tenantRes !== tenantId) return NextResponse.json({ error: '租户上下文不一致' }, { status: 403 })
  const actor = await requireActorTenantRole(session, tenantId)
  if (actor instanceof NextResponse) return actor
  try {
    return NextResponse.json({ requests: await listOwnerTransfersForMember(tenantId, actor.userId, actor.tenantRole === 'owner') })
  } catch {
    return NextResponse.json({ error: 'list_failed' }, { status: 500 })
  }
}
