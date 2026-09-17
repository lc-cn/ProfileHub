import Link from 'next/link'
import { CreateOrganizationForm } from '@/components/tenant/create-organization-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** 已登录即可访问：无租户时用于首次建组织；有租户时可再建新组织并自动切换上下文 */
export default function NewOrganizationPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">← 返回</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>创建新组织</CardTitle>
          <CardDescription>
            创建后你将成为负责人，并自动进入新组织。组织标识须唯一，创建后不可修改。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm />
        </CardContent>
      </Card>
    </div>
  )
}
