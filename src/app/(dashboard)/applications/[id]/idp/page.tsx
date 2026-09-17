import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getApplicationById } from '@/lib/data-access'
import { getOAuth2ClientAdminById } from '@/lib/oauth2/client-admin'
import { ApplicationIdpFormPage } from '../../application-idp-form-page'

type PageProps = { params: Promise<{ id: string }> }

export default async function ApplicationIdpPage({ params }: PageProps) {
  const session = await auth()
  const tid = session?.currentTenantId
  if (!tid) redirect('/platform')
  const { id } = await params
  const app = await getApplicationById(id, tid)
  if (!app) notFound()

  const dto = await getOAuth2ClientAdminById(id)
  const mode = dto ? 'edit' : 'create'

  return (
    <ApplicationIdpFormPage
      issuer={(process.env.OAUTH_ISSUER_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '')}
      applicationId={id}
      applicationName={app.name}
      mode={mode}
      initialRow={dto}
    />
  )
}
