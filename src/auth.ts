import { SESSION_MAX_AGE_SECONDS } from '@/lib/session-policy'
import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import { encode as defaultEncode } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'
import {
  findUserByEmail,
  getUserTenantMembership,
  listTenantPermissionCodesForUser,
  resolveJwtTenantClaims,
} from '@/lib/data-access'
import type { TenantRole } from '@/lib/data-access'
import {
  applyTenantSwitch,
  readTenantPermissionCodesFromToken,
  type TenantClaimsState,
} from '@/lib/auth-token-mutations'
import { verifyStoredPassword } from '@/lib/password'
import { LibsqlAdapter } from '@/lib/next-auth-libsql-adapter'
import { getAuthSecret } from '@/lib/auth-secret'
import { getUserCredentialVersion, getUserMfaRow } from '@/lib/security-data-access'

const providers: NextAuthConfig['providers'] = [
  Credentials({
    id: 'credentials',
    name: 'credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      const email = typeof credentials?.email === 'string' ? credentials.email.trim() : ''
      const password = typeof credentials?.password === 'string' ? credentials.password : ''
      if (!email || !password) return null

      const user = await findUserByEmail(email)
      if (!user?.password || !verifyStoredPassword(user.password, password)) return null
      if (!user.status) return null

      const profileImage = user.image ?? user.avatar ?? undefined
      const mfaRow = await getUserMfaRow(user.id)

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: profileImage,
        requiresMfa: !!(mfaRow?.mfaEnabled ?? false),
      }
    },
  }),
]

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: LibsqlAdapter(),
  trustHost: true,
  // NEXTAUTH_URL / AUTH_URL 与当前浏览器 origin 不一致时，NextAuth v5 仍会把 /api/auth 请求改写到
  // 该变量，导致本地跳到生产。开发换端口请在 .env.local 覆盖 NEXTAUTH_URL。
  secret: getAuthSecret(),
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: '/login',
  },
  providers,
  jwt: {
    encode: async (params) => {
      const token = params.token as { mfaPending?: boolean; mfaDeadline?: number } | undefined
      if (token?.mfaPending === true && typeof token.mfaDeadline === 'number') {
        const nowSec = Math.floor(Date.now() / 1000)
        const maxAge = Math.max(1, token.mfaDeadline - nowSec)
        return defaultEncode({ ...params, maxAge })
      }
      return defaultEncode(params)
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`
      if (url.startsWith(baseUrl)) return url
      try {
        const u = new URL(url)
        const b = new URL(baseUrl)
        if (u.origin === b.origin) return url
        if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return url
      } catch {
        /* ignore */
      }
      return baseUrl
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.id) {
        const u = user as { requiresMfa?: boolean }
        token.sub = user.id
        token.id = user.id
        token.name = user.name ?? undefined
        token.email = user.email ?? undefined
        token.picture = user.image ?? undefined
        const claims = await resolveJwtTenantClaims(user.id)
        token.currentTenantId = claims.currentTenantId
        token.isPlatformAdmin = claims.isPlatformAdmin
        token.tenantRole = claims.tenantRole
        token.tenantPermissionCodes = claims.tenantPermissionCodes
        token.credentialVersion = await getUserCredentialVersion(user.id)
        if (u.requiresMfa) {
          token.mfaPending = true
          token.mfaDeadline = Math.floor(Date.now() / 1000) + 600
        } else {
          delete token.mfaPending
          delete token.mfaDeadline
        }
      }
      if (token.sub && !user?.id) {
        const dbV = await getUserCredentialVersion(String(token.sub))
        if (token.credentialVersion === undefined) {
          token.credentialVersion = dbV
        } else if (token.credentialVersion !== dbV) {
          return null
        }
        // 兼容升级前签发的 JWT：旧 token 没有 `tenantPermissionCodes` 字段，此处按需懒填一次，
        // 避免老会话进入控制台后侧栏与守卫认为「无权限」（与 #11 配合）。
        const tid = typeof token.currentTenantId === 'string' ? token.currentTenantId : null
        if (tid) {
          if (!Array.isArray(token.tenantPermissionCodes)) {
            token.tenantPermissionCodes = await listTenantPermissionCodesForUser(
              String(token.sub),
              tid
            )
          }
        } else if (token.tenantPermissionCodes !== null) {
          token.tenantPermissionCodes = null
        }
      }
      if (trigger === 'update' && session && typeof session === 'object') {
        const s = session as {
          name?: string | null
          email?: string | null
          image?: string | null
          currentTenantId?: string | null
        }
        if ('name' in s) token.name = s.name ?? undefined
        if ('email' in s) token.email = s.email ?? undefined
        if ('image' in s) token.picture = s.image ?? undefined
        if ('currentTenantId' in s && token.sub) {
          const userId = String(token.sub)
          const before: TenantClaimsState = {
            currentTenantId:
              typeof token.currentTenantId === 'string' ? token.currentTenantId : null,
            tenantRole:
              token.tenantRole === 'owner' ||
              token.tenantRole === 'admin' ||
              token.tenantRole === 'member'
                ? (token.tenantRole as TenantRole)
                : null,
            tenantPermissionCodes: readTenantPermissionCodesFromToken(
              token.tenantPermissionCodes
            ),
          }
          const next = await applyTenantSwitch(
            before,
            { userId, rawTenantId: s.currentTenantId },
            async (uid, tid) => {
              const m = await getUserTenantMembership(uid, tid)
              if (!m) return null
              const codes = await listTenantPermissionCodesForUser(uid, tid)
              return { tenantRole: m.tenantRole, tenantPermissionCodes: codes }
            }
          )
          token.currentTenantId = next.currentTenantId
          token.tenantRole = next.tenantRole
          token.tenantPermissionCodes = next.tenantPermissionCodes
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
        if (token.name != null) session.user.name = token.name as string
        if (token.email != null) session.user.email = token.email as string
        if (token.picture != null) session.user.image = token.picture as string
      }
      const tid = typeof token.currentTenantId === 'string' ? token.currentTenantId : null
      session.currentTenantId = tid
      session.isPlatformAdmin = !!token.isPlatformAdmin
      const tr = token.tenantRole
      session.tenantRole =
        tid && (tr === 'owner' || tr === 'admin' || tr === 'member') ? (tr as TenantRole) : null
      // 无 currentTenantId 一律不向 session 暴露 tenantPermissionCodes，
      // 防止「平台只读 / 未选租户」会话错误地携带前一租户的 RBAC 权限（Issue #10）。
      session.tenantPermissionCodes = tid
        ? readTenantPermissionCodesFromToken(token.tenantPermissionCodes)
        : null
      session.mfaPending = !!token.mfaPending
      return session
    },
  },
})
