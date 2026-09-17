import { InvitationAccept } from '@/components/organizations/invitation-accept'
import { featureInvitesEnabled } from '@/lib/wave3-env'
import { notFound } from 'next/navigation'

export default function InvitationsPage() {
  if (!featureInvitesEnabled()) notFound()
  return <div className="mx-auto max-w-xl p-6"><InvitationAccept /></div>
}
