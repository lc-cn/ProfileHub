'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import type { PermissionCode } from '@/lib/permission-codes'

const Enforcement = createContext(true)

/** UI hints only; every mutation still passes the server's authorization checks. */
export function ManagementAccessProvider({ enforce, children }: { enforce: boolean; children: ReactNode }) {
  return <Enforcement.Provider value={enforce}>{children}</Enforcement.Provider>
}

export function useManagementAccess() {
  const { data: session } = useSession()
  const enforce = useContext(Enforcement)
  return {
    session,
    manager: session?.tenantRole === 'owner' || session?.tenantRole === 'admin',
    can: (permission: PermissionCode) => Boolean(session?.currentTenantId && (!enforce || session.tenantPermissionCodes?.includes(permission))),
  }
}
