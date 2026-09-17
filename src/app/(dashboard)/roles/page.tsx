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
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useManagementAccess } from '@/components/tenant/management-access'
import { PermissionCodes as ActionCodes } from '@/lib/permission-codes'
import { useToast } from '@/hooks/use-toast'
import { useI18n } from '@/i18n/context'
import { PageShell, PageHeader, CardToolbar } from '@/components/layout/page-shell'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'

interface Permission {
  feature?: { name: string; application?: { name: string } }
  id: string
  name: string
  code: string
}

interface Role {
  id: string
  name: string
  description?: string
  createdAt: string
  users: { user: { id: string; name: string } }[]
  permissions: { permission: Permission }[]
}

export default function RolesPage() {
  const { t, locale } = useI18n()
  const access = useManagementAccess()
  const canCreate = access.can(ActionCodes.ROLE_CREATE)
  const canEdit = access.can(ActionCodes.ROLE_UPDATE)
  const canDelete = access.can(ActionCodes.ROLE_DELETE)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [search, setSearch] = useState('')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<Role | null>(null)
  const [form, setForm] = useState({ name: '', description: '', permissionIds: [] as string[] })
  const { toast } = useToast()
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  const fetchRoles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/roles?search=${encodeURIComponent(search)}`)
      if (!res.ok) throw new Error(t('roles.fetchFail'))
      setRoles(await res.json())
    } catch {
      toast({ title: t('common.error'), description: t('roles.fetchFail'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [search, toast, t])

  const fetchPermissions = useCallback(async () => {
    const res = await fetch('/api/permissions')
    if (res.ok) setPermissions(await res.json())
  }, [])

  useEffect(() => { fetchRoles() }, [fetchRoles])
  useEffect(() => { void fetchPermissions().catch(() => setPermissions([])) }, [fetchPermissions])

  const openCreate = () => {
    setEditRole(null)
    setForm({ name: '', description: '', permissionIds: [] })
    setDialogOpen(true)
  }

  const openEdit = (role: Role) => {
    setEditRole(role)
    setForm({
      name: role.name,
      description: role.description || '',
      permissionIds: role.permissions.map(p => p.permission.id),
    })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (saving) return
    setSaving(true)
    try {
      const url = editRole ? `/api/roles/${editRole.id}` : '/api/roles'
      const res = await fetch(url, {
        method: editRole ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast({
        title: t('common.success'),
        description: editRole ? t('roles.updated') : t('roles.created'),
      })
      setDialogOpen(false)
      fetchRoles()
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
      const res = await fetch(`/api/roles/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(t('roles.deleteFail'))
      toast({ title: t('common.success'), description: t('roles.deleted') })
      fetchRoles()
    } catch {
      toast({ title: t('common.error'), description: t('roles.deleteFail'), variant: 'destructive' })
    } finally {
      setRemoving(false)
      setDeleteId(null)
    }
  }

  const togglePermission = (id: string) => {
    setForm(prev => ({
      ...prev,
      permissionIds: prev.permissionIds.includes(id)
        ? prev.permissionIds.filter(p => p !== id)
        : [...prev.permissionIds, id],
    }))
  }

  return (
    <PageShell>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.subtitle')}
        actions={
          <Button className="w-full shrink-0 sm:w-auto" disabled={!canCreate} title={!canCreate ? t('experience.readOnly') : undefined} onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t('roles.create')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardToolbar>
            <div className="relative min-w-0 max-w-full flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('roles.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" onClick={fetchRoles}>{t('common.search')}</Button>
          </CardToolbar>
        </CardHeader>
        <CardContent>
          <div className="app-data-table overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="app-table-head">{t('roles.colName')}</th>
                <th className="app-table-head">{t('roles.colDesc')}</th>
                <th className="app-table-head">{t('roles.colUsers')}</th>
                <th className="app-table-head">{t('roles.colPerms')}</th>
                <th className="app-table-head">{t('common.createdAt')}</th>
                <th className="app-table-head app-table-head-end">{t('common.operation')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t('common.loading')}</td></tr>
              ) : roles.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t('common.empty')}</td></tr>
              ) : roles.map(role => (
                <tr key={role.id} className="border-b border-border hover:bg-muted/50">
                  <td className="app-table-cell font-medium">{role.name}</td>
                  <td className="app-table-cell text-muted-foreground">{role.description || '-'}</td>
                  <td className="app-table-cell"><Badge variant="outline">{role.users.length}</Badge></td>
                  <td className="app-table-cell"><Badge variant="outline">{role.permissions.length}</Badge></td>
                  <td className="app-table-cell text-muted-foreground">{new Date(role.createdAt).toLocaleDateString(dateLocale)}</td>
                  <td className="app-table-cell app-table-cell-end">
                    <div className="app-row-actions">
                      <Button variant="ghost" size="sm" aria-label={t('experience.edit') + ' ' + role.name} disabled={!canEdit} title={!canEdit ? t('experience.readOnly') : undefined} onClick={() => openEdit(role)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" aria-label={t('common.delete') + ' ' + role.name} disabled={!canDelete} title={!canDelete ? t('experience.readOnly') : undefined} onClick={() => setDeleteId(role.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
        <DialogContent className="max-w-lg sm:max-w-xl">
          <DialogHeader><DialogTitle>{editRole ? t('roles.editTitle') : t('roles.createTitle')}</DialogTitle></DialogHeader>
          <div className="app-dialog-body">
            <div className="app-form-field">
              <Label>{t('roles.colName')}</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="app-form-field">
              <Label>{t('roles.colDesc')}</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="app-form-field">
              <Label htmlFor="permission-filter">{t('roles.assignPermissions')}</Label>
              <Input id="permission-filter" value={permissionSearch} onChange={e => setPermissionSearch(e.target.value)} placeholder={t('experience.permissionSearch')} />
              <p className="text-sm text-muted-foreground">{t('experience.selected', { count: form.permissionIds.length })}</p>
              <div className="app-picker-grid">
                {permissions.filter(perm => `${perm.name} ${perm.code} ${perm.feature?.name || ''} ${perm.feature?.application?.name || ''}`.toLowerCase().includes(permissionSearch.toLowerCase())).sort((a, b) => `${a.feature?.application?.name}/${a.feature?.name}`.localeCompare(`${b.feature?.application?.name}/${b.feature?.name}`)).map(perm => (
                  <div key={perm.id} className="app-picker-item">
                    <Checkbox
                      id={`perm-${perm.id}`}
                      checked={form.permissionIds.includes(perm.id)}
                      onCheckedChange={() => togglePermission(perm.id)}
                    />
                    <Label
                      htmlFor={`perm-${perm.id}`}
                      className="inline min-w-0 flex-1 cursor-pointer font-normal leading-snug"
                    >
                      <span className="block text-xs text-muted-foreground">{perm.feature?.application?.name} / {perm.feature?.name}</span>
                      <span className="block text-foreground">{perm.name}</span>
                      <span className="mt-0.5 block font-mono text-[0.7rem] text-muted-foreground">{perm.code}</span>
                    </Label>
                  </div>
                ))}
                {permissions.length === 0 && (
                  <p className="col-span-full py-6 text-center text-sm text-muted-foreground">{t('roles.noPermissions')}</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={saving || (editRole ? !canEdit : !canCreate)} onClick={handleSubmit}>{t(saving ? 'experience.saving' : 'common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common.confirmDelete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('roles.deleteConfirm', { name: roles.find(role => role.id === deleteId)?.name || '', count: roles.find(role => role.id === deleteId)?.users.length || 0 })}</AlertDialogDescription>
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
