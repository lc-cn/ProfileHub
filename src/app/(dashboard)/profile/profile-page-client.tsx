'use client'

import { useCallback, useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { PageShell, PageHeader } from '@/components/layout/page-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ProfileSecurityCard } from '@/components/profile/profile-security-card'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'

const PROFILE_TABS = ['general', 'password', 'security', 'danger'] as const
export type ProfileTab = (typeof PROFILE_TABS)[number]

type ProfileUser = {
  id: string
  name: string
  email: string
  image: string | null
  avatar: string | null
  hasPassword: boolean
}

export function ProfilePageClient({ initialTab }: { initialTab?: ProfileTab }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const { update: updateSession } = useSession()

  const defaultTab: ProfileTab =
    initialTab && PROFILE_TABS.includes(initialTab) ? initialTab : 'general'
  const [activeTab, setActiveTab] = useState<ProfileTab>(defaultTab)

  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<ProfileUser | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [image, setImage] = useState('')
  const [avatar, setAvatar] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState('')
  const [deleteEmail, setDeleteEmail] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (initialTab && PROFILE_TABS.includes(initialTab)) {
      queueMicrotask(() => setActiveTab(initialTab))
    }
  }, [initialTab])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/profile')
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('profile.loadFail'), variant: 'destructive' })
        return
      }
      setUser(data.user)
      setName(data.user.name)
      setEmail(data.user.email)
      setImage(data.user.image ?? '')
      setAvatar(data.user.avatar ?? '')
    } catch {
      toast({ title: t('common.error'), description: t('profile.loadFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          image: image.trim() || null,
          avatar: avatar.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('profile.saveFail'), variant: 'destructive' })
        return
      }
      setUser(data.user)
      if (data.sessionPatch) {
        await updateSession({
          name: data.sessionPatch.name,
          email: data.sessionPatch.email,
          image: data.sessionPatch.image,
        })
      }
      toast({ title: t('common.success'), description: t('profile.profileUpdated') })
    } finally {
      setSavingProfile(false)
    }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== newPw2) {
      toast({ title: t('common.error'), description: t('profile.passwordMismatch'), variant: 'destructive' })
      return
    }
    if (newPw.length < 6) {
      toast({ title: t('common.error'), description: t('profile.passwordTooShort'), variant: 'destructive' })
      return
    }
    setSavingPw(true)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(user?.hasPassword ? { currentPassword: curPw } : {}),
          newPassword: newPw,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('profile.passwordChangeFail'), variant: 'destructive' })
        return
      }
      setCurPw('')
      setNewPw('')
      setNewPw2('')
      await load()
      toast({ title: t('common.success'), description: t('profile.passwordChanged') })
    } finally {
      setSavingPw(false)
    }
  }

  async function onDeleteAccount() {
    setDeleting(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          user?.hasPassword ? { password: deletePw } : { confirmEmail: deleteEmail }
        ),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: t('common.error'), description: data.error ?? t('profile.deleteFail'), variant: 'destructive' })
        return
      }
      setDeleteOpen(false)
      await signOut({ callbackUrl: '/login' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageShell density="comfortable">
      <PageHeader title={t('profile.title')} description={t('profile.subtitle')} />

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : !user ? null : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            if (PROFILE_TABS.includes(v as ProfileTab)) setActiveTab(v as ProfileTab)
          }}
          className="w-full min-w-0"
        >
          <TabsList
            aria-label={t('profile.title')}
            className="mb-6 h-auto w-full flex-wrap justify-stretch gap-1 p-1.5 sm:mb-8 sm:inline-flex sm:w-auto sm:justify-start"
          >
            <TabsTrigger value="general" className="min-w-0 flex-1 sm:flex-initial">
              {t('profile.tabGeneral')}
            </TabsTrigger>
            <TabsTrigger value="password" className="min-w-0 flex-1 sm:flex-initial">
              {t('profile.tabPassword')}
            </TabsTrigger>
            <TabsTrigger value="security" className="min-w-0 flex-1 sm:flex-initial">
              {t('profile.tabSecurity')}
            </TabsTrigger>
            <TabsTrigger
              value="danger"
              className="min-w-0 flex-1 border-destructive/25 text-destructive/90 data-[state=active]:border-destructive/40 data-[state=active]:text-destructive sm:flex-initial"
            >
              {t('profile.tabDanger')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" forceMount className="mt-0 data-[state=inactive]:hidden">
            <Card className="mx-auto w-full max-w-xl">
              <CardHeader>
                <CardTitle className="text-base">{t('profile.sectionProfile')}</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={onSaveProfile} className="w-full space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="pf-name">{t('profile.name')}</Label>
                    <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pf-email">{t('profile.email')}</Label>
                    <Input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pf-image">{t('profile.imageUrl')}</Label>
                    <Input id="pf-image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
                  </div>
                  <details className="space-y-2 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t('profile.avatarUrl')}</summary>
                  <div className="space-y-2">
                    <Label htmlFor="pf-avatar">{t('profile.avatarUrl')}</Label>
                    <Input id="pf-avatar" value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" />
                  </div>
                  </details>
                  <Button type="submit" disabled={savingProfile}>
                    {savingProfile ? t('common.loading') : t('profile.saveProfile')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="password" forceMount className="mt-0 data-[state=inactive]:hidden">
            <Card className="mx-auto w-full max-w-xl">
              <CardHeader>
                <CardTitle className="text-base">{t('profile.sectionPassword')}</CardTitle>
              </CardHeader>
              <CardContent>
                {!user.hasPassword ? (
                  <p className="mb-4 text-sm text-muted-foreground">{t('profile.noPasswordHint')}</p>
                ) : null}
                <form onSubmit={onChangePassword} className="w-full space-y-4">
                  {user.hasPassword ? (
                    <div className="space-y-2">
                      <Label htmlFor="pf-cur-pw">{t('profile.currentPassword')}</Label>
                      <Input
                        id="pf-cur-pw"
                        type="password"
                        autoComplete="current-password"
                        value={curPw}
                        onChange={(e) => setCurPw(e.target.value)}
                        required={user.hasPassword}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="pf-new-pw">{t('profile.newPassword')}</Label>
                    <Input
                      id="pf-new-pw"
                      type="password"
                      autoComplete="new-password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pf-new-pw2">{t('profile.confirmNewPassword')}</Label>
                    <Input
                      id="pf-new-pw2"
                      type="password"
                      autoComplete="new-password"
                      value={newPw2}
                      onChange={(e) => setNewPw2(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" disabled={savingPw}>
                    {savingPw ? t('common.loading') : t('profile.changePassword')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" forceMount className="mt-0 data-[state=inactive]:hidden">
            <ProfileSecurityCard hasPassword={user.hasPassword} />
          </TabsContent>

          <TabsContent value="danger" className="mt-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <Card className="mx-auto w-full max-w-xl border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base text-destructive">{t('profile.sectionDanger')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">{t('profile.deleteWarning')}</p>
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  {t('profile.deleteAccount')}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profile.deleteAccount')}</AlertDialogTitle>
            <AlertDialogDescription>{t('profile.deleteWarning')}</AlertDialogDescription>
          </AlertDialogHeader>
          {user?.hasPassword ? (
            <div className="space-y-2 py-2">
              <Label htmlFor="del-pw">{t('profile.deletePlaceholderPassword')}</Label>
              <Input
                id="del-pw"
                type="password"
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          ) : (
            <div className="space-y-2 py-2">
              <Label htmlFor="del-email">{t('profile.deletePlaceholderEmail')}</Label>
              <Input id="del-email" type="email" value={deleteEmail} onChange={(e) => setDeleteEmail(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void onDeleteAccount()
              }}
            >
              {deleting ? t('common.loading') : t('profile.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
