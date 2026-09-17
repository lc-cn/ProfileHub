'use client'

import { useState, useEffect, useCallback, startTransition } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useManagementAccess } from '@/components/tenant/management-access'
import { PermissionCodes as ActionCodes } from '@/lib/permission-codes'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'
import { PageShell, PageHeader, CardToolbar } from '@/components/layout/page-shell'
import { Plus, Pencil, Trash2, Search, Plug } from 'lucide-react'
import { PermissionCodes } from '@/lib/permission-codes'
import { sessionHasTenantRead } from '@/lib/tenant-dashboard-nav-permissions'

interface Application {
  id: string
  name: string
  code: string
  description?: string
  status: boolean
  createdAt: string
  oauthClientId: string | null
  features: { id: string; name: string }[]
}

export default function ApplicationsPage() {
  const { data: session } = useSession()
  const { t, locale } = useI18n()
  const access = useManagementAccess()
  const canCreate = access.can(ActionCodes.APPLICATION_CREATE)
  const canEdit = access.can(ActionCodes.APPLICATION_UPDATE)
  const canDelete = access.can(ActionCodes.APPLICATION_DELETE)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const canManageIdp = sessionHasTenantRead(session, PermissionCodes.OAUTH_CLIENT_READ)
  const [apps, setApps] = useState<Application[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editApp, setEditApp] = useState<Application | null>(null)
  const [form, setForm] = useState({ name: '', code: '', description: '', status: true })
  const { toast } = useToast()
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  const fetchApps = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/applications?search=${encodeURIComponent(search)}`)
      if (!res.ok) throw new Error(t('applications.fetchFail'))
      setApps(await res.json())
    } catch {
      toast({ title: t('common.error'), description: t('applications.fetchFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [search, toast, t])

  useEffect(() => {
    startTransition(() => {
      void fetchApps()
    })
  }, [fetchApps])

  const openCreate = () => {
    setEditApp(null)
    setForm({ name: '', code: '', description: '', status: true })
    setDialogOpen(true)
  }

  const openEdit = (app: Application) => {
    setEditApp(app)
    setForm({ name: app.name, code: app.code, description: app.description || '', status: app.status })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const url = editApp ? `/api/applications/${editApp.id}` : '/api/applications'
      const res = await fetch(url, {
        method: editApp ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast({
        title: t('common.success'),
        description: editApp ? t('applications.updated') : t('applications.created'),
      })
      setDialogOpen(false)
      fetchApps()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      toast({ title: t('common.error'), description: message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId || removing) return
    setRemoving(true)
    try {
      const res = await fetch(`/api/applications/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('applications.deleteFail'))
      toast({ title: t('common.success'), description: t('applications.deleted') })
      fetchApps()
    } catch {
      toast({ title: t('common.error'), description: t('applications.deleteFail'), variant: 'destructive' })
    } finally {
      setRemoving(false)
      setDeleteId(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={t('applications.title')}
        description={t('applications.subtitle')}
        actions={
          <Button className="w-full shrink-0 sm:w-auto" disabled={!canCreate} title={!canCreate ? t('experience.readOnly') : undefined} onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('applications.create')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardToolbar>
            <div className="relative min-w-0 max-w-full flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('applications.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" onClick={fetchApps}>{t('common.search')}</Button>
          </CardToolbar>
        </CardHeader>
        <CardContent>
          <div className="app-data-table overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="app-table-head">{t('applications.colName')}</th>
                <th className="app-table-head">{t('applications.colCode')}</th>
                <th className="app-table-head">{t('applications.colDesc')}</th>
                <th className="app-table-head">{t('applications.colFeatures')}</th>
                <th className="app-table-head">{t('applications.colOidc')}</th>
                <th className="app-table-head">{t('applications.colStatus')}</th>
                <th className="app-table-head">{t('common.createdAt')}</th>
                <th className="app-table-head app-table-head-end">{t('common.operation')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
              ) : apps.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">{t('common.empty')}</td></tr>
              ) : apps.map(app => (
                <tr key={app.id} className="border-b border-border hover:bg-muted/50">
                  <td className="app-table-cell font-medium">{app.name}</td>
                  <td className="app-table-cell font-mono text-xs text-muted-foreground">{app.code}</td>
                  <td className="app-table-cell text-muted-foreground">{app.description || '-'}</td>
                  <td className="app-table-cell"><Badge variant="outline">{app.features.length}</Badge></td>
                  <td className="app-table-cell">
                    {canManageIdp ? (
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
                        <Link href={`/applications/${app.id}/idp`}>
                          <Plug className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                          {app.oauthClientId ? t('applications.idpManage') : t('applications.idpConfigure')}
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="app-table-cell">
                    <Badge variant={app.status ? 'default' : 'secondary'}>
                      {app.status ? t('common.enabled') : t('common.disabled')}
                    </Badge>
                  </td>
                  <td className="app-table-cell text-muted-foreground">{new Date(app.createdAt).toLocaleDateString(dateLocale)}</td>
                  <td className="app-table-cell app-table-cell-end">
                    <div className="app-row-actions">
                      <Button variant="ghost" size="sm" aria-label={t('experience.edit') + ' ' + app.name} disabled={!canEdit} title={!canEdit ? t('experience.readOnly') : undefined} onClick={() => openEdit(app)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" aria-label={t('common.delete') + ' ' + app.name} disabled={!canDelete} title={!canDelete ? t('experience.readOnly') : undefined} onClick={() => setDeleteId(app.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editApp ? t('applications.editTitle') : t('applications.createTitle')}</DialogTitle></DialogHeader>
          <div className="app-dialog-body">
            <div className="app-form-field">
              <Label>{t('applications.colName')}</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="app-form-field">
              <Label>{t('applications.colCode')}</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder={t('applications.codePlaceholder')} />
            </div>
            <div className="app-form-field">
              <Label>{t('common.description')}</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <Checkbox id="appStatus" checked={form.status} onCheckedChange={v => setForm(p => ({ ...p, status: !!v }))} />
              <Label htmlFor="appStatus" className="inline cursor-pointer">{t('common.enabled')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={saving || (!canCreate && !canEdit)} onClick={handleSubmit}>{t(saving ? 'experience.saving' : 'common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('applications.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={removing || !canDelete} onClick={handleDelete} className="bg-red-600 hover:bg-red-700">{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}
