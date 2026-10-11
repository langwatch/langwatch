import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { PageLayout } from "@langwatch/design-system/page-layout";
/**
 * Roles & access: what a role can do, and who holds one where. The Access tab keeps
 * the `?tab=assignments` address the old Role Bindings page forwards onto.
 * Spec: specs/rbac/roles-and-access-ui.feature
 */
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
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
      <VStack align="stretch" width="full" gap={6} paddingTop={4}>
        <Text color="fg.muted">What a role can do, and who holds one where.</Text>

        {/* Only the open tab is mounted: the other holds no read open behind it. */}
        <ContentTabs
          label="Roles and access"
          value={tab}
          onValueChange={({ value }) => selectTab(value)}
          mount="active"
          body="flush"
          items={[
            { value: "roles", label: "Roles", content: <Box paddingTop={10}>{roles}</Box> },
            {
              value: ASSIGNMENTS_TAB,
              label: "Access",
              content: (
                <Box paddingTop={10}>
                  <AccessPanel
                    organizationId={organizationId}
                    canManage={host.hasPermission(AUTHZ_MANAGE_PERMISSION)}
                  />
                </Box>
              ),
            },
          ]}
        />
      </VStack>
    </>
  );
}
