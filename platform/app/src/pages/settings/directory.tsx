import { Tabs, VStack } from "@chakra-ui/react";
import { useSearchParams } from "react-router";
import { DepartmentsSection } from "../../components/access/DepartmentsSection";
import { DirectorySummary } from "../../components/access/DirectorySummary";
import { GroupsSection } from "../../components/access/GroupsSection";
import { PeopleSection } from "../../components/access/PeopleSection";
import { TeamsAndProjectsSection } from "../../components/access/TeamsAndProjectsSection";
import { PermissionAlert } from "../../components/PermissionAlert";
import SettingsLayout from "../../components/SettingsLayout";
import { SettingsPageHeader } from "../../components/settings/SettingsPageHeader";
import { TabCount } from "../../components/settings/TabCount";
import { useDepartmentColumn } from "../../components/settings/useDepartmentColumn";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

/**
 * The Directory: who is in this organization, how they got here, and which
 * system says so (D05, D08, D11, D12, ADR-122).
 *
 * ONE PAGE FOR "WHO IS HERE". Members, Teams & Projects and Access were three
 * navigation entries answering one question in three vocabularies: a list of
 * people, a list of the containers those people sit in, and the rules by which
 * somebody becomes one of them. An administrator asking "who is in my
 * organization and how did they get here" had to visit all three and hold the
 * answer in their head. They are the Directory now, and the three old
 * addresses forward onto the tab each became.
 *
 * NAMED FOR WHAT IT HOLDS, NOT FOR THE PROTOCOL THAT FILLS IT. The navigation
 * entry says Directory, because "SCIM" is a thing an IT administrator has
 * heard of and everybody else has not. The word survives in the body copy, so
 * the administrator who searches for the protocol still lands here.
 *
 * STATUS LEADS, AND STANDS ABOVE THE TABS. Which sources are connected, when
 * the last push landed, how many people the directory manages and how many
 * members it does NOT manage are the reason anybody opens this page, and every
 * tab under them is what to do about the answer. Putting the band inside a tab
 * would hide the question from three quarters of the page.
 *
 * THREE TABS EVERY READER HAS, THREE SUBJECTS, DRAWN ONE WAY.
 *
 *   People ─── everybody here and everybody on their way in, as three cuts
 *              of one list
 *   Teams ──── the teams, and the projects each one holds
 *   Groups ─── every group in the organization, the sent ones and the
 *              hand-made ones alike
 *
 * A FOURTH TAB JOINS ONLY WHERE THERE IS ANYTHING TO PUT ON IT. Departments
 * are the AI-governance org structure, managed on Governance's People page;
 * the Directory references them for the organizations that have them, beside
 * the people and teams they count. An organization without departments, and
 * a reader without `governance:view`, never sees the tab — an address naming
 * it falls back to the people.
 *
 * Each tab puts its own action at the end of its own first heading row, and
 * each carries its count on the tab itself. Three tabs that each placed those
 * somewhere else read as three products rather than one page.
 *
 * PROVISIONING IS NOT HERE ANY MORE. Whether a connector is syncing, what it
 * could not apply, where to point it and what credential to point it with are
 * all about how people ARRIVE, which is Authentication's subject; this page
 * answers who arrived. The old address forwards onto the connectors page. The
 * rules that admit people went the same way, for the same reason.
 *
 * ONE PERMISSION FOR THE TABS, and it is `organization:manage`. The status
 * band above them reads what the directory has been doing, which is a
 * security reviewer's question and takes `sso:view` — so a reader may hold
 * that and see the band while every tab below it stays a membership read.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export default function DirectorySettings() {
  const { organization } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return <DirectorySettingsContent organizationId={organization.id} />;
}

const TABS = ["people", "teams", "groups"] as const;
/** The three every reader has; "departments" joins where the org has any. */
type DirectoryTab = (typeof TABS)[number] | "departments";

/** What the reader may open here. */
interface DirectoryReach {
  /** `sso:view`: the status band above the tabs. */
  maySeeSync: boolean;
  /**
   * `organization:manage`: the people, the teams and the groups — every tab
   * on this page, and the counts that read membership.
   */
  mayManageMembership: boolean;
}

/**
 * The tab actually opened, given what the address asked for and what the
 * reader may have.
 *
 * A tab a reader may not open never becomes the open one, however the address
 * arrived — a link a colleague pasted, a bookmark, or one of the old
 * addresses forwarding onto the tab it became. Pure, so the decision can be
 * read in one place.
 *
 * EVERY TAB IS BEHIND THE SAME PERMISSION NOW. Provisioning was the one that
 * was not, and it has moved to Authentication, where the rest of "how do
 * people arrive" lives — so a reader holding only `sso:view` has no tab to
 * open here rather than one.
 */
export function resolveDirectoryTab({
  requested,
  available = TABS,
}: {
  requested: string | null;
  /**
   * The tabs this reader may actually open. Defaults to the base three, so
   * the departments tab is only ever resolved for a reader whose page offered
   * it — a `?tab=departments` address that arrives without one falls back to
   * the people like any other tab that is not there.
   */
  available?: readonly DirectoryTab[];
}): DirectoryTab {
  return available.includes(requested as DirectoryTab)
    ? (requested as DirectoryTab)
    : "people";
}

function DirectorySettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const reach: DirectoryReach = {
    maySeeSync: hasPermission("sso:view"),
    mayManageMembership: hasPermission("organization:manage"),
  };
  // The counts the tabs carry. Read here rather than inside each tab, because
  // a number on a closed tab is the reason somebody opens it — a count that
  // only appears once you are already looking answers nothing.
  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  const teams = api.team.getTeamsWithRoleBindings.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  // The same reads the People tab runs, so react-query serves both from one
  // request and the tab's number can never disagree with its own list.
  const members =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: true },
      { enabled: reach.mayManageMembership && !!organizationId },
    );
  const invites = api.organization.getOrganizationPendingInvites.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );
  const waiting = api.joinRequests.pending.useQuery(
    { organizationId },
    { enabled: reach.mayManageMembership && !!organizationId },
  );

  // Whether the departments tab has anything to say. The hook degrades to
  // "nothing to show" for a reader the departments queries refuse, and the
  // permission check keeps the tab from ever being offered to one — for them
  // there is no error and no empty frame, the tab simply never appears.
  const department = useDepartmentColumn(organizationId);
  const maySeeDepartments = department.show && hasPermission("governance:view");

  /**
   * Everybody the People tab would list: the members, the invitations still
   * waiting on somebody, and the people asking to join. Undefined until all
   * three have answered, so the tab shows no number rather than a number that
   * is about to grow.
   */
  const peopleCount =
    members.data && invites.data && waiting.data
      ? members.data.members.length +
        invites.data.filter(
          (invite) =>
            invite.displayStatus === "PENDING" ||
            invite.displayStatus === "EXPIRED",
        ).length +
        waiting.data.length
      : undefined;

  // Which tab is open lives in the address, so "the group you mapped is
  // here" is a link that opens on the groups rather than on the status.
  const [searchParams, setSearchParams] = useSearchParams();
  const availableTabs: readonly DirectoryTab[] = maySeeDepartments
    ? [...TABS, "departments"]
    : TABS;
  const tab = resolveDirectoryTab({
    requested: searchParams.get("tab"),
    available: availableTabs,
  });

  const selectTab = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        // Overview is the default, so it stays out of the address entirely.
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  // Every tab reads membership now that provisioning has moved, so a reader
  // without it has no page here rather than an empty one.
  if (!reach.mayManageMembership) {
    return (
      <SettingsLayout>
        <PermissionAlert permission="organization:manage" />
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        {/* THE WAY BACK to Authentication is on the sources fact in the
            band below, as a plus beside the sources themselves. A whole
            sentence of a button under the page title said the same thing
            louder, in the one place a reader is looking for the page's own
            subject rather than for somewhere else to go. */}
        <SettingsPageHeader
          title="Directory"
          description="Who is in this organization, how they got here, and which system says so."
        />

        {reach.maySeeSync && (
          <DirectorySummary
            organizationId={organizationId}
            canReadMembership={reach.mayManageMembership}
          />
        )}

        <DirectoryTabs
          organizationId={organizationId}
          tab={tab}
          onSelectTab={selectTab}
          maySeeDepartments={maySeeDepartments}
          peopleCount={peopleCount}
          teamsCount={teams.data?.length}
          groupsCount={groups.data?.length}
          departmentsCount={department.departments.length}
        />
      </VStack>
    </SettingsLayout>
  );
}

/**
 * The tabs themselves. Only ever rendered for a reader holding
 * `organization:manage` — the page refuses everybody else above — so the
 * membership tabs carry no permission check of their own; the departments
 * tab is the one that comes and goes, with what the organization has and
 * what the reader may view.
 */
function DirectoryTabs({
  organizationId,
  tab,
  onSelectTab,
  maySeeDepartments,
  peopleCount,
  teamsCount,
  groupsCount,
  departmentsCount,
}: {
  organizationId: string;
  tab: DirectoryTab;
  onSelectTab: (next: string) => void;
  /** `governance:view` plus an org that actually has departments. */
  maySeeDepartments: boolean;
  peopleCount: number | undefined;
  teamsCount: number | undefined;
  groupsCount: number | undefined;
  departmentsCount: number;
}) {
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(event) => onSelectTab(event.value)}
      colorPalette="orange"
      width="full"
    >
      {/* The same gap Roles leaves under its own tabs. Two tabbed
          settings pages sitting one menu item apart must not breathe
          differently.

          The explicit space before each count is not decoration: a flex
          container drops whitespace-only children from layout but keeps
          them in the text the accessible name is computed from, so
          without it a tab announces as "Groups4", one run-together
          token. */}
      <Tabs.List marginBottom={6}>
        <Tabs.Trigger value="people" gap={2}>
          People <TabCount value={peopleCount} />
        </Tabs.Trigger>
        <Tabs.Trigger value="teams" gap={2}>
          Teams &amp; projects <TabCount value={teamsCount} />
        </Tabs.Trigger>
        <Tabs.Trigger value="groups" gap={2}>
          Groups <TabCount value={groupsCount} />
        </Tabs.Trigger>
        {maySeeDepartments && (
          <Tabs.Trigger value="departments" gap={2}>
            Departments <TabCount value={departmentsCount} />
          </Tabs.Trigger>
        )}
      </Tabs.List>

      <Tabs.Content value="people">
        {/* Only the tab being read is mounted: a closed tab must not
            hold a read of every member in the organization open behind
            it, nor offer its actions to somebody looking elsewhere. */}
        {tab === "people" && <PeopleSection organizationId={organizationId} />}
      </Tabs.Content>

      <Tabs.Content value="teams">
        {tab === "teams" && (
          <TeamsAndProjectsSection organizationId={organizationId} />
        )}
      </Tabs.Content>

      <Tabs.Content value="groups">
        {tab === "groups" && (
          <GroupsSection organizationId={organizationId} canManage={true} />
        )}
      </Tabs.Content>

      {maySeeDepartments && (
        <Tabs.Content value="departments">
          {tab === "departments" && (
            <DepartmentsSection organizationId={organizationId} />
          )}
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
