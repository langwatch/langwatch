import { Link } from "@langwatch/browser-host/link";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
// Roles screen; three-state plan gate; grant asked twice for future reuse.
import { Button, Skeleton, VStack } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";

import { AUTHZ_MANAGE_PERMISSION, useAuthzHost } from "../../model/authz-host.ts";
import { RolesPanel } from "./roles-panel.tsx";
import { RolesTabs } from "./roles-tabs.tsx";

export default function RolesScreen() {
  const host = useAuthzHost();
  const { organizationId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();

  if (!organizationId || isPlanLoading) {
    return (
      <>
        <RolesHeader />
        <VStack gap={6} width="full" align="stretch" paddingTop={4}>
          <Skeleton height="20px" width="320px" />
          <Skeleton height="200px" borderRadius="xl" />
        </VStack>
      </>
    );
  }

  if (!isEnterprise) {
    return (
      <>
        <RolesHeader />
        <NoDataInfoBlock
          size="page"
          icon={<Lock />}
          title="Roles & access is included in Enterprise"
          description="Define your own roles and choose exactly what each person or group may do, and where."
          testId="roles-enterprise-upsell"
          primaryAction={
            <Button asChild colorPalette="orange" size="sm">
              <Link href="/settings/plans">See plans</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <RolesTabs
      host={host}
      organizationId={organizationId}
      roles={
        <RolesPanel
          organizationId={organizationId}
          canManage={host.hasPermission(AUTHZ_MANAGE_PERMISSION)}
          canReadAuditLog={host.hasPermission("auditLog:view")}
        />
      }
    />
  );
}

function RolesHeader() {
  return (
    <PageLayout.Header>
      <PageLayout.Heading>Roles &amp; access</PageLayout.Heading>
    </PageLayout.Header>
  );
}
