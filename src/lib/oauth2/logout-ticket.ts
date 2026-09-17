import { SignJWT, jwtVerify } from 'jose'
import { getAuthSecret } from '@/lib/auth-secret'

const key = () => new TextEncoder().encode(getAuthSecret())

/** Short-lived, purpose-bound ticket for the same-origin Auth.js logout callback. */
export async function signLogoutTicket(clientId: string | null, target: string) {
  return new SignJWT({ clientId, target })
    .setProtectedHeader({ alg: 'HS256', typ: 'oauth-logout+jwt' })
    .setAudience('oauth-logout-complete').setIssuedAt().setExpirationTime('10m').sign(key())
}

export async function verifyLogoutTicket(ticket: string) {
  const { payload } = await jwtVerify(ticket, key(), {
    algorithms: ['HS256'], audience: 'oauth-logout-complete', typ: 'oauth-logout+jwt',
  })
  if (typeof payload.target !== 'string' || (payload.clientId !== null && typeof payload.clientId !== 'string')) {
    throw new Error('Invalid logout ticket')
  }
  return { clientId: payload.clientId as string | null, target: payload.target }
}
