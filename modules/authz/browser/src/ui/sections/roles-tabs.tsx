/**
 * Roles & access: what a role can do, and who holds one where. The Access tab keeps
 * the `?tab=assignments` address the old Role Bindings page forwards onto.
 * Spec: specs/rbac/roles-and-access-ui.feature
 */
import { Tabs, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import type { ReactNode } from "react";

import { AUTHZ_MANAGE_PERMISSION, type AuthzHostApi } from "../../model/authz-host.ts";
import { AccessPanel } from "./access-panel.tsx";

/** Roles is the default tab, so it stays out of the address entirely. */
const ASSIGNMENTS_TAB = "assignments";

export function RolesTabs({
  host,
  organizationId,
  roles,
}: {
  host: AuthzHostApi;
  organizationId: string;
  /** The definitions tab: the built-in and custom roles. */
  roles: ReactNode;
}) {
  const route = host.route();
  const tab = route.query.tab === ASSIGNMENTS_TAB ? ASSIGNMENTS_TAB : "roles";
  const selectTab = (next: string) =>
    host.setQuery(
      { ...route.query, tab: next === ASSIGNMENTS_TAB ? next : void 0 },
      { replace: true },
    );

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Roles &amp; access</PageLayout.Heading>
      </PageLayout.Header>
      <VStack align="start" width="full" gap={6} paddingTop={4}>
        <Text color="fg.muted" fontSize="sm">
          What a role can do, and who holds one where.
        </Text>

        <Tabs.Root
          value={tab}
          onValueChange={(event) => selectTab(event.value)}
          colorPalette="orange"
          width="full"
        >
          <Tabs.List marginBottom={6}>
            <Tabs.Trigger value="roles">Roles</Tabs.Trigger>
            <Tabs.Trigger value={ASSIGNMENTS_TAB}>Access</Tabs.Trigger>
          </Tabs.List>

          {/* Only the open tab is mounted: the other holds no read open behind it. */}
          <Tabs.Content value="roles">{tab === "roles" && roles}</Tabs.Content>
          <Tabs.Content value={ASSIGNMENTS_TAB}>
            {tab === ASSIGNMENTS_TAB && (
              <AccessPanel
                organizationId={organizationId}
                canManage={host.hasPermission(AUTHZ_MANAGE_PERMISSION)}
              />
            )}
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </>
  );
}
