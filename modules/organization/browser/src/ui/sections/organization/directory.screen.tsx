import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { PageLayout } from "@langwatch/design-system/page-layout";
/**
 * /settings/directory: who is here, how they got here, and which system says so.
 * Members, Teams and Groups are its tabs; their old addresses forward onto them.
 * Spec: specs/identity/directory-administration.feature
 */
import { Box, VStack } from "@langwatch/design-system/primitives";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { Suspense } from "react";

import { useDepartmentColumn } from "../../../behavior/use-department-column.ts";
import { useDirectoryTabCounts } from "../../../behavior/use-directory-tab-counts.ts";
import {
  DIRECTORY_TAB_PARAM,
  parseDirectoryTab,
  type DirectoryTab,
} from "../../../model/directory-tabs.ts";
import { useOrganizationHost, type OrganizationHostApi } from "../../../model/organization-host.ts";
import { PermissionAlert } from "../../elements/permission-alert.tsx";
import DepartmentsScreen from "./departments.screen.tsx";
import GroupsScreen from "./groups.screen.tsx";
import MembersScreen from "./members.screen.tsx";
import TeamsScreen from "./teams.screen.tsx";

/** Every tab reads membership, so the page takes the permission the tabs take. */
const DIRECTORY_PERMISSION = "organization:manage";

export default function DirectoryScreen() {
  const host = useOrganizationHost();
  const { organizationId } = host.scope();
  if (!organizationId) return null;
  if (!host.hasOrganizationPermission(DIRECTORY_PERMISSION)) {
    return <PermissionAlert permission={DIRECTORY_PERMISSION} area="the directory" />;
  }

  return <Directory host={host} organizationId={organizationId} />;
}

function Directory({
  host,
  organizationId,
}: {
  host: OrganizationHostApi;
  organizationId: string;
}) {
  const route = host.route();
  const department = useDepartmentColumn(
    organizationId,
    host.isFeatureEnabled(FrontendFlags.release_ui_ai_governance_enabled),
  );
  const departmentsShown = department.show && host.hasOrganizationPermission("governance:view");
  const tab = parseDirectoryTab({
    value: route.query[DIRECTORY_TAB_PARAM],
    departmentsShown,
  });
  const selectTab = (next: string) =>
    host.setQuery(
      { ...route.query, [DIRECTORY_TAB_PARAM]: next === "people" ? void 0 : next },
      { replace: true },
    );
  const Summary = host.directorySummary();

  return (
    <>
      <PageLayout.Header description="Who is in this organization, how they got here, and which system says so.">
        <PageLayout.Heading>Directory</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={3} width="full" align="stretch">
        {/* The status band reads what the directory has been doing: sso:view. */}
        {Summary && host.hasOrganizationPermission("sso:view") && (
          <Suspense fallback={null}>
            <Summary organizationId={organizationId} canReadMembership={true} />
          </Suspense>
        )}

        <DirectoryTabs
          organizationId={organizationId}
          tab={tab}
          onSelectTab={selectTab}
          departmentCount={departmentsShown ? department.departments.length : undefined}
        />
      </VStack>
    </>
  );
}

/** Only the open tab is mounted: a closed tab holds no read open behind it. */
function DirectoryTabs({
  organizationId,
  tab,
  onSelectTab,
  departmentCount,
}: {
  organizationId: string;
  tab: DirectoryTab;
  onSelectTab: (next: string) => void;
  /** Undefined where the Departments tab is not offered to this reader. */
  departmentCount: number | undefined;
}) {
  const counts = useDirectoryTabCounts({ organizationId, enabled: true });

  return (
    <ContentTabs
      label="Directory"
      value={tab}
      onValueChange={({ value }) => onSelectTab(value)}
      mount="active"
      body="flush"
      items={[
        {
          value: "people",
          label: "People",
          count: counts.people,
          content: (
            <Box paddingTop={3}>
              <MembersScreen />
            </Box>
          ),
        },
        {
          value: "teams",
          label: "Teams & projects",
          count: counts.teams,
          content: (
            <Box paddingTop={3}>
              <TeamsScreen />
            </Box>
          ),
        },
        {
          value: "groups",
          label: "Groups",
          count: counts.groups,
          content: (
            <Box paddingTop={3}>
              <GroupsScreen />
            </Box>
          ),
        },
        ...(departmentCount === void 0
          ? []
          : [
              {
                value: "departments",
                label: "Departments",
                count: departmentCount,
                content: (
                  <Box paddingTop={3}>
                    <DepartmentsScreen organizationId={organizationId} />
                  </Box>
                ),
              },
            ]),
      ]}
    />
  );
}
