// Roles screen; three-state plan gate; grant asked twice for future reuse.

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Skeleton, VStack } from "@langwatch/design-system/primitives";

import { AUTHZ_MANAGE_PERMISSION, useAuthzHost } from "../../model/authz-host.ts";
import { EnterpriseUpsell } from "../elements/enterprise-upsell.tsx";
import { RolesPanel } from "./roles-panel.tsx";
import { RolesTabs } from "./roles-tabs.tsx";

export default function RolesScreen() {
  const host = useAuthzHost();
  const { organizationId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();

  if (!organizationId || isPlanLoading) {
    return <Skeleton width="full" height="200px" />;
  }

  if (!isEnterprise) {
    return (
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Roles &amp; access</PageLayout.Heading>
        </PageLayout.Header>
        <VStack gap={6} width="full" align="start" paddingTop={4}>
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Enterprise Feature</Alert.Title>
              <Alert.Description>
                Custom roles are available on Enterprise plans. Contact sales to upgrade.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <EnterpriseUpsell />
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
