import { OrganizationCollaboration } from '@/components/organizations/organization-collaboration'
import { featureInvitesEnabled, featureOwnerTransferEnabled } from '@/lib/wave3-env'
import { sessionHasTenantRead } from '@/lib/tenant-dashboard-nav-permissions'
import { PermissionCodes } from '@/lib/permission-codes'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getTenantCurrentSummaryForMember } from '@/lib/data-access'
import { redirectPathWhenMissingCurrentTenant } from '@/lib/organizations-current-redirect'
import { CurrentOrganizationView } from '@/components/organizations/current-organization-view'

export const dynamic = 'force-dynamic'

export default async function CurrentOrganizationPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login?callbackUrl=%2Forganizations%2Fcurrent')
  }
  const tid = session.currentTenantId ?? null
  if (!tid) {
    redirect(redirectPathWhenMissingCurrentTenant(!!session.isPlatformAdmin))
  }
  const summary = await getTenantCurrentSummaryForMember(session.user.id, tid)
  if (!summary) {
    notFound()
  }
  return <><CurrentOrganizationView name={summary.name} slug={summary.slug} lifecycle={summary.lifecycle} currentUserId={session.user.id} />
    <OrganizationCollaboration key={tid} tenantId={tid} userId={session.user.id}
      invites={featureInvitesEnabled()} transfers={featureOwnerTransferEnabled()}
      owner={session.tenantRole === 'owner'}
      canReadInvites={sessionHasTenantRead(session, PermissionCodes.USER_READ)}
      canInvite={(session.tenantRole === 'owner' || session.tenantRole === 'admin') && sessionHasTenantRead(session, PermissionCodes.USER_CREATE)}
    /></>
}
