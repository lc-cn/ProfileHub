/**
 * Issue #5：租户内路由与 Permission.code 的对照（审计用单一清单）。
 * Handler 内实际仍以各 route 调用的 `guardTenantRbac` / `PermissionCodes` 为准。
 */
import { PermissionCodes as P } from './permission-codes.ts'

export const TENANT_ROUTE_PERMISSION_AUDIT = [
  { method: 'GET', route: '/api/organizations/current', permission: '—', governance: 'UserTenant 成员；会话 currentTenantId' },
  { method: 'GET', route: '/api/organizations/current/members', permission: '—', governance: 'UserTenant 成员；会话 currentTenantId' },
  { method: 'GET', route: '/api/users', permission: P.USER_READ, governance: '—' },
  { method: 'POST', route: '/api/users', permission: P.USER_CREATE, governance: 'owner|admin' },
  { method: 'GET', route: '/api/users/[id]', permission: P.USER_READ, governance: '—' },
  { method: 'PUT', route: '/api/users/[id]', permission: P.USER_UPDATE, governance: 'owner|admin' },
  { method: 'DELETE', route: '/api/users/[id]', permission: P.USER_DELETE, governance: 'owner|admin; 不可删 owner' },

  { method: 'GET', route: '/api/roles', permission: P.ROLE_READ, governance: '—' },
  { method: 'POST', route: '/api/roles', permission: P.ROLE_CREATE, governance: '—' },
  { method: 'GET', route: '/api/roles/[id]', permission: P.ROLE_READ, governance: '—' },
  { method: 'PUT', route: '/api/roles/[id]', permission: P.ROLE_UPDATE, governance: '—' },
  { method: 'DELETE', route: '/api/roles/[id]', permission: P.ROLE_DELETE, governance: '—' },

  { method: 'GET', route: '/api/permissions', permission: P.PERM_READ, governance: '—' },
  { method: 'POST', route: '/api/permissions', permission: P.PERM_CREATE, governance: '—' },
  { method: 'GET', route: '/api/permissions/[id]', permission: P.PERM_READ, governance: '—' },
  { method: 'PUT', route: '/api/permissions/[id]', permission: P.PERM_UPDATE, governance: '—' },
  { method: 'DELETE', route: '/api/permissions/[id]', permission: P.PERM_DELETE, governance: '—' },

  { method: 'GET', route: '/api/applications', permission: P.APPLICATION_READ, governance: '—' },
  { method: 'POST', route: '/api/applications', permission: P.APPLICATION_CREATE, governance: '—' },
  { method: 'GET', route: '/api/applications/[id]', permission: P.APPLICATION_READ, governance: '—' },
  { method: 'PUT', route: '/api/applications/[id]', permission: P.APPLICATION_UPDATE, governance: '—' },
  { method: 'DELETE', route: '/api/applications/[id]', permission: P.APPLICATION_DELETE, governance: '—' },

  { method: 'GET', route: '/api/features', permission: P.FEATURE_READ, governance: '—' },
  { method: 'POST', route: '/api/features', permission: P.FEATURE_CREATE, governance: '—' },
  { method: 'GET', route: '/api/features/[id]', permission: P.FEATURE_READ, governance: '—' },
  { method: 'PUT', route: '/api/features/[id]', permission: P.FEATURE_UPDATE, governance: '—' },
  { method: 'DELETE', route: '/api/features/[id]', permission: P.FEATURE_DELETE, governance: '—' },

  { method: 'GET', route: '/api/applications/[id]/oauth', permission: P.OAUTH_CLIENT_READ, governance: '—', notes: '密钥敏感' },
  { method: 'POST', route: '/api/applications/[id]/oauth', permission: P.OAUTH_CLIENT_WRITE, governance: '—' },
  { method: 'PUT', route: '/api/applications/[id]/oauth', permission: P.OAUTH_CLIENT_WRITE, governance: '—' },
  { method: 'DELETE', route: '/api/applications/[id]/oauth', permission: P.OAUTH_CLIENT_WRITE, governance: '—' },

  { method: 'GET', route: '/api/system-config', permission: P.SYSTEM_CONFIG_READ, governance: '—' },
  { method: 'PUT', route: '/api/system-config', permission: P.SYSTEM_CONFIG_UPDATE, governance: '—' },

  { method: 'GET', route: '/api/tenants/[tenantId]/invitations', permission: P.USER_READ, governance: '—' },
  { method: 'POST', route: '/api/tenants/[tenantId]/invitations', permission: P.USER_CREATE, governance: 'owner|admin' },
  { method: 'PATCH', route: '/api/tenants/[tenantId]/lifecycle', permission: '—', governance: 'owner only' },
  { method: 'GET', route: '/api/tenants/[tenantId]/owner-transfer', permission: '—', governance: '当前组织成员；负责人查看全部，其余仅查看自己接收的请求' },
  { method: 'POST', route: '/api/tenants/[tenantId]/owner-transfer', permission: '—', governance: 'owner only' },
  { method: 'POST', route: '/api/tenants/[tenantId]/owner-transfer/confirm', permission: '—', governance: '受邀用户' },
  { method: 'POST', route: '/api/invitations/accept', permission: '—', governance: '登录用户；无租户上下文' },
] as const
