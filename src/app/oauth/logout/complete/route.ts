import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/session'
import { verifyLogoutTicket } from '@/lib/oauth2/logout-ticket'
import { oauthJsonError } from '@/lib/oauth2/request'

export async function GET(req: NextRequest) {
  try {
    const ticket = await verifyLogoutTicket(req.nextUrl.searchParams.get('ticket') || '')
    if ((await getServerAuthSession())?.user) return oauthJsonError(400, 'invalid_request', '请先确认登出')
    return NextResponse.redirect(ticket.target, { status: 303, headers: {
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    } })
  } catch {
    return oauthJsonError(400, 'invalid_request', '登出回调无效或已过期')
  }
}
