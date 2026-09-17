import { ConfigurationView } from './configuration-view'
import { SESSION_MAX_AGE_SECONDS } from '@/lib/session-policy'
import { resolveTotpIssuer } from '@/lib/mfa-totp'

export const dynamic = 'force-dynamic'

export default async function SystemConfigPage() {
  return <ConfigurationView
    issuer={(process.env.OAUTH_ISSUER_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '')}
    issuerSource={process.env.OAUTH_ISSUER_URL ? 'OAUTH_ISSUER_URL' : 'NEXTAUTH_URL'}
    sessionDays={SESSION_MAX_AGE_SECONDS / 86400}
    totpIssuer={await resolveTotpIssuer()}
    totpSource={process.env.MFA_TOTP_ISSUER?.trim() ? 'MFA_TOTP_ISSUER' : 'SystemConfig.site_name / Console'}
  />
}
