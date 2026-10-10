import { Link } from "@langwatch/browser-host/link";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
import { PageLayout } from "@langwatch/design-system/page-layout";
// Roles screen; three-state plan gate; grant asked twice for future reuse.
import { Button, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";

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
        <VStack gap={6} width="full" align="start" paddingTop={4}>
          <Text color="fg.muted">What a role can do, and who holds one where.</Text>
          <UpgradeRequired
            feature="Custom roles"
            actions={
              <Button asChild colorPalette="orange" size="sm">
                <Link href="/settings/plans">Compare plans</Link>
              </Button>
            }
          />
        </VStack>
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
