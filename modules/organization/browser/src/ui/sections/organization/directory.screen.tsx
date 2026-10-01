import { PageLayout } from "@langwatch/design-system/page-layout";
/**
 * /settings/directory: who is here, how they got here, and which system says so.
 * Members, Teams and Groups are its tabs; their old addresses forward onto them.
 * Spec: specs/identity/directory-administration.feature
 */
import { Tabs, Text, VStack } from "@langwatch/design-system/primitives";
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
import { TabCount } from "../../elements/tab-count.tsx";
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
    return <PermissionAlert permission={DIRECTORY_PERMISSION} />;
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
    host.isFeatureEnabled("release_ui_ai_governance_enabled"),
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
      <PageLayout.Header>
        <PageLayout.Heading>Directory</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          Who is in this organization, how they got here, and which system says so.
        </Text>

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
    <Tabs.Root
      value={tab}
      onValueChange={(event) => onSelectTab(event.value)}
      colorPalette="orange"
      width="full"
    >
      <Tabs.List marginBottom={6}>
        <Tabs.Trigger value="people" gap={2}>
          People <TabCount value={counts.people} />
        </Tabs.Trigger>
        <Tabs.Trigger value="teams" gap={2}>
          Teams &amp; projects <TabCount value={counts.teams} />
        </Tabs.Trigger>
        <Tabs.Trigger value="groups" gap={2}>
          Groups <TabCount value={counts.groups} />
        </Tabs.Trigger>
        {departmentCount !== void 0 && (
          <Tabs.Trigger value="departments" gap={2}>
            Departments <TabCount value={departmentCount} />
          </Tabs.Trigger>
        )}
      </Tabs.List>

      <Tabs.Content value="people">{tab === "people" && <MembersScreen />}</Tabs.Content>
      <Tabs.Content value="teams">{tab === "teams" && <TeamsScreen />}</Tabs.Content>
      <Tabs.Content value="groups">{tab === "groups" && <GroupsScreen />}</Tabs.Content>
      {departmentCount !== void 0 && (
        <Tabs.Content value="departments">
          {tab === "departments" && <DepartmentsScreen organizationId={organizationId} />}
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
