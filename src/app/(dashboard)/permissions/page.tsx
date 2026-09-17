'use client'

import { useState, useEffect, useCallback } from 'react'
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
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useManagementAccess } from '@/components/tenant/management-access'
import { PermissionCodes as ActionCodes } from '@/lib/permission-codes'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'
import { PageShell, PageHeader, CardToolbar } from '@/components/layout/page-shell'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'

interface Application {
  id: string
  name: string
  code: string
}

interface Feature {
  id: string
  name: string
  code: string
  applicationId: string
  application: Application
}

interface Permission {
  id: string
  name: string
  code: string
  description?: string
  featureId: string
  feature: Feature
  createdAt: string
}

export default function PermissionsPage() {
  const { t } = useI18n()
  const access = useManagementAccess()
  const canCreate = access.can(ActionCodes.PERM_CREATE)
  const canEdit = access.can(ActionCodes.PERM_UPDATE)
  const canDelete = access.can(ActionCodes.PERM_DELETE)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [features, setFeatures] = useState<Feature[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editPerm, setEditPerm] = useState<Permission | null>(null)
  const [form, setForm] = useState({ name: '', code: '', description: '', featureId: '' })
  const { toast } = useToast()

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [permsRes, featuresRes, appsRes] = await Promise.all([
        fetch(`/api/permissions?search=${encodeURIComponent(search)}`),
        fetch('/api/features'),
        fetch('/api/applications'),
      ])
      setPermissions(await permsRes.json())
      setFeatures(await featuresRes.json())
      setApplications(await appsRes.json())
    } catch {
      toast({ title: t('common.error'), description: t('permissions.loadFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [search, toast, t])

  useEffect(() => { fetchAll() }, [fetchAll])

  const grouped = applications.map(app => ({
    app,
    features: features
      .filter(f => f.applicationId === app.id)
      .map(f => ({
        feature: f,
        permissions: permissions.filter(p => p.featureId === f.id),
      })),
    total: permissions.filter(p => p.feature?.application?.id === app.id).length,
  }))

  const openCreate = () => {
    setEditPerm(null)
    setForm({ name: '', code: '', description: '', featureId: '' })
    setDialogOpen(true)
  }

  const openEdit = (perm: Permission) => {
    setEditPerm(perm)
    setForm({ name: perm.name, code: perm.code, description: perm.description || '', featureId: perm.featureId })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const url = editPerm ? `/api/permissions/${editPerm.id}` : '/api/permissions'
      const res = await fetch(url, {
        method: editPerm ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast({
        title: t('common.success'),
        description: editPerm ? t('permissions.updated') : t('permissions.created'),
      })
      setDialogOpen(false)
      fetchAll()
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
      const res = await fetch(`/api/permissions/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('permissions.deleteFail'))
      toast({ title: t('common.success'), description: t('permissions.deleted') })
      fetchAll()
    } catch {
      toast({ title: t('common.error'), description: t('permissions.deleteFail'), variant: 'destructive' })
    } finally {
      setRemoving(false)
      setDeleteId(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={t('permissions.title')}
        description={t('permissions.subtitle')}
        actions={
          <Button className="w-full shrink-0 sm:w-auto" disabled={!canCreate} title={!canCreate ? t('experience.readOnly') : undefined} onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('permissions.create')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardToolbar>
            <div className="relative min-w-0 max-w-full flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('permissions.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" onClick={fetchAll}>{t('common.search')}</Button>
          </CardToolbar>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground sm:py-12">{t('common.loading')}</div>
      ) : (
        <Accordion type="multiple" className="app-accordion-stack">
          {grouped.map(({ app, features: featureGroups, total }) => (
            <AccordionItem
              key={app.id}
              value={app.id}
              className="rounded-xl border border-border/50 bg-card shadow-card ring-1 ring-black/[0.03] dark:ring-white/10"
            >
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline sm:px-5 sm:py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                  <span className="min-w-0 break-words font-semibold text-foreground">{app.name}</span>
                  <Badge variant="outline" className="shrink-0 text-xs">{app.code}</Badge>
                  <Badge className="shrink-0 text-xs">{t('permissions.countBadge', { count: total })}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-6 px-3 pb-4 sm:space-y-7 sm:px-5 sm:pb-5">
                {featureGroups.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">{t('permissions.noFeatures')}</p>
                ) : featureGroups.map(({ feature, permissions: perms }) => (
                  <div key={feature.id} className="space-y-3 sm:space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{feature.name}</span>
                      <Badge variant="secondary" className="text-xs">{feature.code}</Badge>
                    </div>
                    {perms.length === 0 ? (
                      <p className="pl-4 text-xs text-muted-foreground">{t('permissions.noPermissionsUnder')}</p>
                    ) : (
                      <div className="-mx-1 overflow-x-auto sm:mx-0">
                      <table className="w-full min-w-[28rem] text-sm">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="app-table-head text-xs sm:text-sm">{t('permissions.colName')}</th>
                            <th className="app-table-head text-xs sm:text-sm">{t('permissions.colCode')}</th>
                            <th className="app-table-head text-xs sm:text-sm">{t('permissions.colDesc')}</th>
                            <th className="app-table-head app-table-head-end text-xs sm:text-sm">{t('common.operation')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perms.map(perm => (
                            <tr key={perm.id} className="border-t border-border hover:bg-muted/40">
                              <td className="app-table-cell text-sm">{perm.name}</td>
                              <td className="app-table-cell font-mono text-xs text-muted-foreground">{perm.code}</td>
                              <td className="app-table-cell text-muted-foreground">{perm.description || '-'}</td>
                              <td className="app-table-cell app-table-cell-end">
                                <div className="app-row-actions">
                                  <Button variant="ghost" size="sm" aria-label={t('experience.edit') + ' ' + perm.name} disabled={!canEdit} title={!canEdit ? t('experience.readOnly') : undefined} onClick={() => openEdit(perm)}><Pencil className="h-3 w-3" /></Button>
                                  <Button variant="ghost" size="sm" aria-label={t('common.delete') + ' ' + perm.name} disabled={!canDelete} title={!canDelete ? t('experience.readOnly') : undefined} onClick={() => setDeleteId(perm.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
          {grouped.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground sm:py-12">{t('permissions.noApps')}</div>
          )}
        </Accordion>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editPerm ? t('permissions.editTitle') : t('permissions.createTitle')}</DialogTitle></DialogHeader>
          <div className="app-dialog-body">
            <div className="app-form-field">
              <Label>{t('permissions.parentFeature')}</Label>
              <Select value={form.featureId} onValueChange={v => setForm(p => ({ ...p, featureId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t('permissions.selectFeature')} />
                </SelectTrigger>
                <SelectContent>
                  {features.map(f => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.application?.name} / {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="app-form-field">
              <Label>{t('permissions.colName')}</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="app-form-field">
              <Label>{t('permissions.colCode')}</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder={t('permissions.placeholderCode')} />
            </div>
            <div className="app-form-field">
              <Label>{t('common.description')}</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
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
            <AlertDialogDescription>{t('permissions.deleteConfirm')}</AlertDialogDescription>
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
