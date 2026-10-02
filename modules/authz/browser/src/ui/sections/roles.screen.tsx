// Roles screen; three-state plan gate; grant asked twice for future reuse.

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";

import { AUTHZ_MANAGE_PERMISSION, useAuthzHost } from "../../model/authz-host.ts";
import { EnterpriseUpsell } from "../elements/enterprise-upsell.tsx";
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

function RolesHeader() {
  return (
    <PageLayout.Header>
      <PageLayout.Heading>Roles &amp; access</PageLayout.Heading>
    </PageLayout.Header>
  );
}
