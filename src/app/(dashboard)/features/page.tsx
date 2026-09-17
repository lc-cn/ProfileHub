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
  description?: string
  applicationId: string
  application: Application
  permissions: { id: string }[]
  createdAt: string
}

export default function FeaturesPage() {
  const { t, locale } = useI18n()
  const access = useManagementAccess()
  const canCreate = access.can(ActionCodes.FEATURE_CREATE)
  const canEdit = access.can(ActionCodes.FEATURE_UPDATE)
  const canDelete = access.can(ActionCodes.FEATURE_DELETE)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [features, setFeatures] = useState<Feature[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editFeature, setEditFeature] = useState<Feature | null>(null)
  const [form, setForm] = useState({ name: '', code: '', description: '', applicationId: '' })
  const { toast } = useToast()
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [featRes, appsRes] = await Promise.all([
        fetch(`/api/features?search=${encodeURIComponent(search)}`),
        fetch('/api/applications'),
      ])
      if (!featRes.ok || !appsRes.ok) throw new Error(t('features.loadFail'))
      setFeatures(await featRes.json())
      setApplications(await appsRes.json())
    } catch {
      toast({ title: t('common.error'), description: t('features.loadFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [search, toast, t])

  useEffect(() => { fetchAll() }, [fetchAll])

  const openCreate = () => {
    setEditFeature(null)
    setForm({ name: '', code: '', description: '', applicationId: '' })
    setDialogOpen(true)
  }

  const openEdit = (feature: Feature) => {
    setEditFeature(feature)
    setForm({ name: feature.name, code: feature.code, description: feature.description || '', applicationId: feature.applicationId })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const url = editFeature ? `/api/features/${editFeature.id}` : '/api/features'
      const res = await fetch(url, {
        method: editFeature ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast({
        title: t('common.success'),
        description: editFeature ? t('features.updated') : t('features.created'),
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
      const res = await fetch(`/api/features/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('features.deleteFail'))
      toast({ title: t('common.success'), description: t('features.deleted') })
      fetchAll()
    } catch {
      toast({ title: t('common.error'), description: t('features.deleteFail'), variant: 'destructive' })
    } finally {
      setRemoving(false)
      setDeleteId(null)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={t('features.title')}
        description={t('features.subtitle')}
        actions={
          <Button className="w-full shrink-0 sm:w-auto" disabled={!canCreate} title={!canCreate ? t('experience.readOnly') : undefined} onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('features.create')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardToolbar>
            <div className="relative min-w-0 max-w-full flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('features.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" onClick={fetchAll}>{t('common.search')}</Button>
          </CardToolbar>
        </CardHeader>
        <CardContent>
          <div className="app-data-table overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="app-table-head">{t('features.colName')}</th>
                <th className="app-table-head">{t('features.colCode')}</th>
                <th className="app-table-head">{t('features.colApp')}</th>
                <th className="app-table-head">{t('features.colDesc')}</th>
                <th className="app-table-head">{t('features.colPerms')}</th>
                <th className="app-table-head">{t('common.createdAt')}</th>
                <th className="app-table-head app-table-head-end">{t('common.operation')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
              ) : features.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t('common.empty')}</td></tr>
              ) : features.map(f => (
                <tr key={f.id} className="border-b border-border hover:bg-muted/50">
                  <td className="app-table-cell font-medium">{f.name}</td>
                  <td className="app-table-cell font-mono text-xs text-muted-foreground">{f.code}</td>
                  <td className="app-table-cell"><Badge variant="outline">{f.application?.name || '-'}</Badge></td>
                  <td className="app-table-cell text-muted-foreground">{f.description || '-'}</td>
                  <td className="app-table-cell"><Badge variant="secondary">{f.permissions.length}</Badge></td>
                  <td className="app-table-cell text-muted-foreground">{new Date(f.createdAt).toLocaleDateString(dateLocale)}</td>
                  <td className="app-table-cell app-table-cell-end">
                    <div className="app-row-actions">
                      <Button variant="ghost" size="sm" aria-label={t('experience.edit') + ' ' + f.name} disabled={!canEdit} title={!canEdit ? t('experience.readOnly') : undefined} onClick={() => openEdit(f)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" aria-label={t('common.delete') + ' ' + f.name} disabled={!canDelete} title={!canDelete ? t('experience.readOnly') : undefined} onClick={() => setDeleteId(f.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
          <DialogHeader><DialogTitle>{editFeature ? t('features.editTitle') : t('features.createTitle')}</DialogTitle></DialogHeader>
          <div className="app-dialog-body">
            <div className="app-form-field">
              <Label>{t('features.colApp')}</Label>
              <Select value={form.applicationId} onValueChange={v => setForm(p => ({ ...p, applicationId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder={t('features.selectApp')} />
                </SelectTrigger>
                <SelectContent>
                  {applications.map(app => (
                    <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="app-form-field">
              <Label>{t('features.colName')}</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="app-form-field">
              <Label>{t('features.colCode')}</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder={t('features.codePlaceholder')} />
            </div>
            <div className="app-form-field">
              <Label>{t('common.description')}</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={saving || (editFeature ? !canEdit : !canCreate)} onClick={handleSubmit}>{t(saving ? 'experience.saving' : 'common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('features.deleteConfirm')}</AlertDialogDescription>
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
