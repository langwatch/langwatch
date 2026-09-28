/**
 * Roles: what a role can do, and who holds one. The second tab was a page
 * called Role Bindings; its old address forwards onto `?tab=assignments`.
 * Spec: specs/identity/org-access-cluster.feature
 */
import { Heading, Tabs, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import type { AuthzHostApi } from "../../model/authz-host.ts";
import { RoleAssignmentsPanel } from "./role-assignments-panel.tsx";

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
    <VStack align="start" width="full" gap={6}>
      <VStack align="start" gap={1}>
        <Heading as="h2">Roles</Heading>
        <Text color="fg.muted" fontSize="sm">
          What a role can do, and who holds one.
        </Text>
      </VStack>

      <Tabs.Root
        value={tab}
        onValueChange={(event) => selectTab(event.value)}
        colorPalette="orange"
        width="full"
      >
        <Tabs.List marginBottom={6}>
          <Tabs.Trigger value="roles">Roles</Tabs.Trigger>
          <Tabs.Trigger value={ASSIGNMENTS_TAB}>Role assignments</Tabs.Trigger>
        </Tabs.List>

        {/* Only the open tab is mounted: the other holds no read open behind it. */}
        <Tabs.Content value="roles">{tab === "roles" && roles}</Tabs.Content>
        <Tabs.Content value={ASSIGNMENTS_TAB}>
          {tab === ASSIGNMENTS_TAB && <RoleAssignmentsPanel organizationId={organizationId} />}
        </Tabs.Content>
      </Tabs.Root>
    </VStack>
  );
}
