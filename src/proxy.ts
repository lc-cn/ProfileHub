import { NextResponse, type NextRequest } from 'next/server'
import { auth } from '@/auth'

/** 需要当前租户上下文的页面与 API（业务读写区域） */
function pathNeedsTenant(pathname: string): boolean {
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/auth')) return false
    if (pathname === '/api/oauth/consent') return false
    if (pathname.startsWith('/api/profile')) return false
    if (pathname.startsWith('/api/platform')) return false
    if (pathname.startsWith('/api/invitations')) return false
    if (pathname === '/api/tenants' || pathname.startsWith('/api/tenants/')) return false
    if (pathname.startsWith('/api/organizations/current')) return false
    return true
  }
  if (
    pathname === '/login' ||
    pathname.startsWith('/docs') ||
    pathname.startsWith('/.well-known') ||
    pathname.startsWith('/oauth/')
  ) {
    return false
  }
  if (
    pathname === '/invitations' ||
    pathname === '/no-tenant' ||
    pathname === '/profile' ||
    pathname === '/organizations/new' ||
    pathname === '/organizations/current' ||
    pathname.startsWith('/platform')
  ) {
    return false
  }
  return true
}

type AuthToken = {
  user?: unknown
  currentTenantId?: string | null
  isPlatformAdmin?: boolean
}

/**
 * 控制台登录页 `callbackUrl`：仅允许本站同源路径（含以 `/` 开头的站内相对路径），
 * 防止开放重定向；`//` 协议相对 URL、`/login` 回环回落首页。
 */
function safeConsoleCallbackPath(req: NextRequest, raw: string | null): string {
  if (!raw?.trim()) return '/'
  const t = raw.trim()
  if (t.startsWith('//')) return '/'
  try {
    const u = t.startsWith('/') ? new URL(t, req.nextUrl.origin) : new URL(t)
    if (u.origin !== req.nextUrl.origin) return '/'
    const path = u.pathname + u.search + u.hash
    if (path === '/login' || path.startsWith('/login?')) return '/'
    return path || '/'
  } catch {
    return '/'
  }
}

// Lazy `NextAuth(async () => …)` makes `auth(mw)` return Promise<handler>; Next requires `proxy` to be a function.
const withAuth = auth((req) => {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/.well-known')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/docs')) {
    return NextResponse.next()
  }
  if (
    pathname === '/oauth/token' ||
    pathname === '/oauth/userinfo' ||
    pathname === '/oauth/revoke' ||
    pathname === '/oauth/introspect' ||
    pathname === '/oauth/logout' ||
    pathname === '/oauth/logout/complete'
  ) {
    return NextResponse.next()
  }

  const isLogin = pathname === '/login'
  const token = req.auth as AuthToken | null | undefined

  if (!token?.user && !isLogin) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('callbackUrl', pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }

  if (token?.user && isLogin) {
    const rawCb = req.nextUrl.searchParams.get('callbackUrl')
    const path = safeConsoleCallbackPath(req, rawCb)
    return NextResponse.redirect(new URL(path, req.nextUrl.origin))
  }

  if (!token?.user) {
    return NextResponse.next()
  }

  const currentTenantId = token.currentTenantId ?? null
  const isPlatformAdmin = !!token.isPlatformAdmin
  const needsTenant = pathNeedsTenant(pathname)

  if (needsTenant && !currentTenantId) {
    if (isPlatformAdmin) {
      const url = req.nextUrl.clone()
      url.pathname = '/platform'
      url.search = ''
      return NextResponse.redirect(url)
    }
    const url = req.nextUrl.clone()
    url.pathname = '/no-tenant'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (pathname === '/no-tenant' && currentTenantId) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  const isPlatformZone =
    pathname === '/platform' ||
    pathname.startsWith('/platform/') ||
    pathname.startsWith('/api/platform')
  if (isPlatformZone && !isPlatformAdmin) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

type AuthHandler = Awaited<typeof withAuth>

export async function proxy(request: NextRequest, context: Parameters<AuthHandler>[1]) {
  const handle = await withAuth
  return handle(request, context)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
