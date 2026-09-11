<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
import { Box, Button, Heading, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { Archive, ExternalLink, MoreVertical, Pencil } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import { DepartmentEditDrawer } from "../../../features/departments/ui/sections/department-edit-drawer.tsx";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { Menu } from "@langwatch/design-system/menu";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { HandledErrorAlert } from "../../../ui/elements/handled-error-alert.tsx";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { api, type RouterOutputs } from "../../../behavior/governance-api.ts";
=======
import {
  Badge,
  Box,
  Button,
  Collapsible,
  Heading,
  HStack,
  Spinner,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { groupObservedDepartments } from "@ee/governance/services/logic/observedDepartments";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  MoreVertical,
  Pencil,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  departmentNameForActor,
  EnterpriseLockedLine,
  sourceForTarget,
} from "~/components/governance/PeopleTable";
import { AssignDepartmentDialog } from "~/components/governance/people/AssignDepartmentDialog";
import {
  type DepartmentRecord,
  type DepartmentTableRow,
  mergeDepartmentRows,
} from "~/components/governance/people/departmentRows";
import { PeopleFilterBar } from "~/components/governance/people/PeopleFilterBar";
import {
  SPEND_WINDOW_DAYS,
  usePeopleFilters,
} from "~/components/governance/people/peopleFilters";
import {
  departmentsPresent,
  filterByDepartment,
  mergePeopleRows,
  type PeopleRow,
} from "~/components/governance/people/peopleRows";
import { summarizePeople } from "~/components/governance/people/peopleSummary";
import {
  SAMPLE_DEPARTMENTS,
  samplePeopleRows,
} from "~/components/governance/people/samplePeople";
import {
  providerLabel,
  UnifiedPeopleTable,
} from "~/components/governance/people/UnifiedPeopleTable";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode,
} from "~/components/governance/sample";
import { GovernanceSummaryBar } from "~/components/governance/summary";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { DepartmentEditDrawer } from "~/components/settings/DepartmentEditDrawer";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import {
  HandledErrorAlert,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSpendSortParam } from "~/hooks/useSpendSortParam";
import { api, type RouterOutputs } from "~/utils/api";

>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
type Department = RouterOutputs["departments"]["list"][number];
/**
 * All the department list renders. Narrower than the stored row on purpose:
 * sample mode supplies invented departments that have no record behind them,
 * and a shape demanding timestamps would force it to invent those too.
 */
type DepartmentListItem = Pick<Department, "id" | "name">;
type MatchSuggestion = RouterOutputs["governancePeople"]["suggestions"][number];

/**
 * The People page: everyone who used AI through a connected source and everyone
 * the connected providers named, on one table, and every department either the
 * organization or a connected directory names, on one table on a second tab.
 *
 * ONE TABLE. The screen used to carry two — a spend ranking and a separate
 * "people the providers see" list — which asked the reader to join two
 * measurements of the same population by eye. `mergePeopleRows` joins them,
 * timidly: two providers naming the same address stay two rows, because
 * deciding they are the same human is the match engine's job.
 *
 * The page opens on `governance:view`. The table's money comes from the
 * activity monitor, which is its own grant and its own plan gate; the identity
 * half comes from `governance:view` and is written with `governance:manage`,
 * so the header's Run match pass and Add department appear only for a manager.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
function PeoplePage() {
  const { organization, hasAnyPermission } = useGovernanceScope();
=======
const PEOPLE_TABS = ["people", "departments"] as const;
type PeopleTab = (typeof PEOPLE_TABS)[number];
const DEFAULT_TAB: PeopleTab = "people";

const isPeopleTab = (value: string | null): value is PeopleTab =>
  PEOPLE_TABS.some((tab) => tab === value);

/**
 * A selected non-default tab is part of the address; the default stays out
 * of it, and an unknown value degrades to the default instead of a blank
 * pane. Every other parameter (the sort, the department) is preserved.
 */
function usePeopleTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: PeopleTab = isPeopleTab(requested) ? requested : DEFAULT_TAB;
  const selectTab = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === DEFAULT_TAB) params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  return { tab, selectTab };
}

/** The address that opens the create-department drawer on arrival. */
const ADD_DEPARTMENT_PARAM = "add";

/**
 * The deep link that arrives asking for a department:
 * `/governance/people?tab=departments&add=1`, which is how another screen sends
 * a reader here to create one.
 *
 * The parameter is a request, not state. It is honoured once, and then cleared
 * from the address on the render after the drawer has landed in it — reading
 * `drawer.open` rather than latching a flag, so the clear cannot run before the
 * open it is waiting for. A reader without the manage grant has the parameter
 * cleared and no drawer, because the create mutation would only refuse them.
 */
function useAddDepartmentDeepLink({ canManage }: { canManage: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openDrawer } = useDrawer();

  const requested = searchParams.get(ADD_DEPARTMENT_PARAM) === "1";
  const drawerOpen = searchParams.get("drawer.open");
  const opened = useRef(false);

  useEffect(() => {
    if (!requested) {
      opened.current = false;
      return;
    }

    const clear = () =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.delete(ADD_DEPARTMENT_PARAM);
          return params;
        },
        { replace: true },
      );

    if (!canManage || drawerOpen === "addDepartment") {
      clear();
      return;
    }
    if (opened.current) return;
    opened.current = true;
    openDrawer("addDepartment");
  }, [requested, drawerOpen, canManage, openDrawer, setSearchParams]);
}

/**
 * Every read the page makes, in one place, because the sample decision and the
 * merged table both need all of them and neither owns the other.
 */
function usePeopleReads({
  orgId,
  windowDays,
  sortBy,
  canReadActivity,
  canReadSources,
}: {
  orgId: string;
  windowDays: number;
  sortBy: ReturnType<typeof useSpendSortParam>["sortBy"];
  canReadActivity: boolean;
  canReadSources: boolean;
}) {
  // The spend read is Enterprise-gated server-side and the gate answers with a
  // bare refusal, so the plan is checked here first: a non-Enterprise
  // organization gets the locked line without a request that can only fail.
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();
  const planAllows = isPlanLoading || isEnterprise;

  const spend = api.activityMonitor.spendByUser.useQuery(
    {
      organizationId: orgId,
      windowDays,
      limit: 500,
      sortBy,
      sortDir: "desc",
    },
    {
      enabled: !!orgId && canReadActivity && planAllows,
      refetchOnWindowFocus: false,
    },
  );
  const people = api.governancePeople.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const suggestions = api.governancePeople.suggestions.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const departments = api.departments.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const assignments = api.departments.assignments.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const sources = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && canReadSources, refetchOnWindowFocus: false },
  );

  const lockedByPlan =
    (!isPlanLoading && !isEnterprise) ||
    readHandledError(spend.error)?.code === "enterprise_plan_required";

  return {
    spend,
    people,
    suggestions,
    departments,
    assignments,
    sources,
    lockedByPlan,
  };
}

/**
 * Everything the page has to settle before it can render anything: which
 * organization is being read, what the reader is allowed to see of it, what
 * they have filtered and sorted to, the reads that all of that decides, and the
 * rows those reads come out as.
 *
 * Gathered here because the answers depend on one another — the reads come from
 * the grants and the sort, the rows come from the reads and the sample choice —
 * and reading the page body should not mean reading that chain first.
 */
function usePeopleScreen() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("governance:manage");

  // Handed back whole rather than spread out, so that a caller passing the sort
  // or the filters straight through to a child says so in one line.
  const spendSort = useSpendSortParam();
  const filters = usePeopleFilters();

  const reads = usePeopleReads({
    orgId,
    // Fixed, because the page no longer offers the reader a window to pick and
    // the read has no unbounded mode. The table says which window it read.
    windowDays: SPEND_WINDOW_DAYS,
    sortBy: spendSort.sortBy,
    canReadActivity,
    canReadSources,
  });

  const refreshers = usePeopleRefreshers({ orgId });
  const runMatch = useRunMatchPass({
    orgId,
    onFinished: refreshers.refreshIdentity,
  });
  const sample = useSampleMode();
  useAddDepartmentDeepLink({ canManage });

  const departmentTab = departmentTabRows({
    sampleActive: sample.active,
    reads,
  });
  // The table's rows are built once, here, so the strip above the tabs and the
  // table inside them can never report different populations.
  const allRows = usePeopleTableRows({ sampleActive: sample.active, reads });

  return {
    orgId,
    canReadActivity,
    canManage,
    spendSort,
    filters,
    reads,
    refreshers,
    runMatch,
    sample,
    departmentTab,
    allRows,
  };
}

function PeoplePage() {
  const { tab, selectTab } = usePeopleTab();
  const screen = usePeopleScreen();
  const { canManage, runMatch, sample, departmentTab, allRows, reads } = screen;
  const { openDrawer } = useDrawer();

  const [assigning, setAssigning] = useState<PeopleRow | null>(null);

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <VStack align="start" gap={1}>
          <Text fontSize="xs" color="fg.muted">
            <Link href="/governance" color="blue.600">
              ← AI Governance
            </Link>{" "}
            · Departments
          </Text>
          <Heading size="md">Departments</Heading>
          <Text color="fg.muted" fontSize="sm" maxW="2xl">
            A department is an accounting label for spend. Assign people, teams, and projects to
            one, and spend rolls up by department across the org, including personal AI use.
            Departments never grant or restrict access.
          </Text>
        </VStack>

        <HandledErrorAlert error={listQuery.error} fallbackTitle="Couldn't load departments" />

        {canManage && <CreateDepartmentBox orgId={orgId} onCreated={refresh} />}

        <DepartmentList
          orgId={orgId}
          departments={departments}
          isLoading={listQuery.isLoading}
          onChanged={refresh}
=======
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <PeoplePageHeader
          sampleActive={sample.active}
          onToggleSample={sample.toggle}
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
          canManage={canManage}
          isRunningMatch={runMatch.isRunning}
          onRunMatch={runMatch.run}
          onAddDepartment={() => openDrawer("addDepartment")}
        />

        <PeopleSampleBanner active={sample.active} />

        <PeopleSummaryStrip
          rows={allRows}
          departmentCount={departmentTab.recordCount}
          sampleActive={sample.active}
          reads={reads}
        />

        <PeopleTabsSection
          tab={tab}
          onSelectTab={selectTab}
          screen={screen}
          onAssignDepartment={setAssigning}
        />
      </VStack>

      <AssignDepartmentDialog
        orgId={screen.orgId}
        personName={assigning?.displayName ?? ""}
        userId={assigning?.linkedUserId ?? null}
        currentDepartmentId={null}
        departments={reads.departments.data ?? []}
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        onAssigned={screen.refreshers.refreshAssignments}
      />
    </GovernanceLayout>
  );
}

/**
 * Running a match pass over the people the providers named.
 *
 * The header only needs to know whether one is in flight and how to start it,
 * so what it gets back is those two things rather than the mutation. What the
 * pass found is reported as a toast, since nothing on the screen changes until
 * the identity reads come back.
 */
function useRunMatchPass({
  orgId,
  onFinished,
}: {
  orgId: string;
  onFinished: () => Promise<void>;
}) {
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const [newName, setNewName] = useState("");
  const createMutation = api.departments.create.useMutation({
    onSuccess: async () => {
      setNewName("");
      toaster.create({ title: "Department created", type: "success" });
      await onCreated();
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't create department" }),
=======
  const mutation = api.governancePeople.runMatch.useMutation({
    onSuccess: async (outcome) => {
      toaster.create({
        title: "Match pass finished",
        description: `${outcome.linked} linked, ${outcome.unproven} unproven. Suggestions refresh as pull sources deliver people.`,
        type: "success",
      });
      await onFinished();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't run the match pass" }),
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
  });

  return {
    isRunning: mutation.isPending,
    run: () => mutation.mutate({ organizationId: orgId }),
  };
}

/**
 * The tab shell and both panes.
 *
 * It takes the settled screen whole rather than fifteen separate props: every
 * one of them would be passed straight through unchanged, and a wrapper that
 * restates its argument list adds a place for the two to drift apart without
 * adding anything a reader learns from.
 *
 * The panes are lazily mounted and unmounted on exit, so the pane the reader is
 * not looking at holds no table and runs no render.
 */
function PeopleTabsSection({
  tab,
  onSelectTab,
  screen,
  onAssignDepartment,
}: {
  tab: PeopleTab;
  onSelectTab: (next: string) => void;
  screen: ReturnType<typeof usePeopleScreen>;
  onAssignDepartment: (row: PeopleRow) => void;
}) {
  const {
    orgId,
    canReadActivity,
    canManage,
    spendSort,
    filters,
    reads,
    refreshers,
    sample,
    departmentTab,
    allRows,
  } = screen;

  return (
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={4}>
      <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
        Create a department
      </Text>
      <HStack>
        <Input
          size="sm"
          maxW="sm"
          placeholder="e.g. Engineering, Marketing"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
=======
    <Tabs.Root
      value={tab}
      onValueChange={({ value }) => onSelectTab(value)}
      variant="line"
      lazyMount
      unmountOnExit
    >
      <PeopleTabsList />
      <Tabs.Content value="people" paddingTop={4}>
        <PeopleTabPane
          orgId={orgId}
          reads={reads}
          allRows={allRows}
          sampleActive={sample.active}
          canReadActivity={canReadActivity}
          canManage={canManage}
          department={filters.department}
          onDepartmentChange={filters.setDepartment}
          sortBy={spendSort.sortBy}
          onSortChange={spendSort.setSortBy}
          onAssignDepartment={onAssignDepartment}
          onSuggestionsChanged={refreshers.refreshIdentity}
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
        />
      </Tabs.Content>
      <Tabs.Content value="departments" paddingTop={4}>
        <DepartmentsTabPane
          orgId={orgId}
          rows={departmentTab.rows}
          isLoading={!sample.active && reads.departments.isLoading}
          error={sample.active ? null : reads.departments.error}
          // Invented rows carry no record to rename or archive.
          canManage={canManage && !sample.active}
          canManageGrant={canManage}
          onChanged={refreshers.refreshDepartments}
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}

/**
 * The two tab triggers. Their own component because the styling repeats and the
 * page body reads better with the tabs named once than with fourteen lines of
 * identical trigger markup between the header and the panes.
 */
function PeopleTabsList() {
  return (
    <Tabs.List>
      <Tabs.Trigger
        value="people"
        color="fg.muted"
        _selected={{ color: "fg", fontWeight: "semibold" }}
      >
        People
      </Tabs.Trigger>
      <Tabs.Trigger
        value="departments"
        color="fg.muted"
        _selected={{ color: "fg", fontWeight: "semibold" }}
      >
        Departments
      </Tabs.Trigger>
    </Tabs.List>
  );
}

/**
 * Every read the page invalidates after a write, gathered because three of them
 * are needed in three different places and each one is a different set of
 * queries. A caller says what changed, not which queries that touches.
 */
function usePeopleRefreshers({ orgId }: { orgId: string }) {
  const utils = api.useUtils();

  const refreshDepartments = async () => {
    await utils.departments.list.invalidate({ organizationId: orgId });
  };
  const refreshIdentity = async () => {
    await Promise.all([
      utils.governancePeople.list.invalidate({ organizationId: orgId }),
      utils.governancePeople.suggestions.invalidate({ organizationId: orgId }),
    ]);
  };
  const refreshAssignments = async () => {
    await utils.departments.assignments.invalidate({ organizationId: orgId });
  };

  return { refreshDepartments, refreshIdentity, refreshAssignments };
}

/**
 * The Departments tab's one list, and the figure the summary strip counts.
 *
 * The two come back together because they are two readings of the same thing
 * and must not be built from different data: `rows` is every department the tab
 * shows, the organization's own and the ones the connected directories name;
 * `recordCount` is how many of those the organization actually created, which
 * is what the strip's "departments" figure has always meant and what spend
 * rolls up by.
 *
 * Sample mode answers for both at once — a screen showing invented departments
 * beside a real directory reading, or the reverse, would be telling the reader
 * two stories. The invented shapes are built by hand: a sample department is a
 * name with nothing behind it, so the identifiers are made up here to give the
 * rows something to key by, the counts descend so the list reads like a real
 * directory rather than a column of identical numbers, and the invented
 * departments deliberately carry the SAME names as the invented directory ones,
 * because that collision is the case the merge exists to handle and a sample
 * that never shows it is teaching the wrong shape.
 */
function departmentTabRows({
  sampleActive,
  reads,
}: {
  sampleActive: boolean;
  reads: ReturnType<typeof usePeopleReads>;
}): { rows: DepartmentTableRow[]; recordCount: number } {
  if (!sampleActive) {
    const departments = reads.departments.data ?? [];
    return {
      rows: mergeDepartmentRows({
        departments,
        observed: groupObservedDepartments(reads.people.data ?? []),
      }),
      recordCount: departments.length,
    };
  }

  const departments: DepartmentListItem[] = SAMPLE_DEPARTMENTS.map(
    (name, index) => ({ id: `sample-department-${index}`, name }),
  );
  return {
    rows: mergeDepartmentRows({
      departments,
      observed: SAMPLE_DEPARTMENTS.map((name, index) => ({
        name,
        peopleCount: 4 - index,
        providers: ["copilot_studio_dataverse"],
      })),
    }),
    recordCount: departments.length,
  };
}

/**
 * The line that says the figures below are invented. Its own component only so
 * that the page body names the banner once instead of carrying six lines of
 * copy in the middle of the layout.
 */
function PeopleSampleBanner({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <SampleDataBanner>
      These people and departments are illustrations of what this page shows
      once a source has delivered rows — nothing here is real.
    </SampleDataBanner>
  );
}

/**
 * The resume above the tabs: what this page holds, in four figures, before the
 * reader has picked a tab.
 *
 * Every figure is counted off rows the page has already read — the merged
 * table and the department list — so the strip can never disagree with what is
 * underneath it. None of them is a guess: a read that has not answered leaves
 * its figure unmeasured and the shared strip draws an em dash, because a zero
 * would tell an organization it has nobody when the truth is that we have not
 * looked yet.
 *
 * In sample mode the figures count the invented rows, and the page's sample
 * banner sits directly above this strip — so the disclaimer is read before the
 * numbers it covers, and no real reading is ever mixed in with them.
 */
function PeopleSummaryStrip({
  rows,
  departmentCount,
  sampleActive,
  reads,
}: {
  rows: PeopleRow[];
  departmentCount: number;
  sampleActive: boolean;
  reads: ReturnType<typeof usePeopleReads>;
}) {
  // Invented rows are complete by construction. Real ones are only complete
  // once both halves of the population have come back: the money the gateway
  // metered, and the people the connected providers named.
  //
  // An answer arrived, not merely "is not loading". A tRPC query that was
  // never enabled is not loading and never will be, so `!isLoading` reads a
  // skipped read as a finished one: the spend read is off for a reader without
  // `activityMonitor:view` and off again for a non-Enterprise organization,
  // and the departments read is off until `orgId` arrives. Each of those would
  // have printed a confident population counted from the identity half alone,
  // directly under a table showing that same reader a permission notice.
  //
  // `data !== undefined` rather than `isSuccess`, which is the same test the
  // catalog hook's `loaded` flag already makes, for the same reason: it asks
  // whether there is something to count instead of trusting a status enum.
  const peopleMeasured =
    sampleActive ||
    (reads.spend.data !== undefined && reads.people.data !== undefined);
  const departmentsMeasured =
    sampleActive || reads.departments.data !== undefined;

  const summary = summarizePeople({
    rows,
    departmentCount,
    peopleMeasured,
    departmentsMeasured,
  });

  return (
    <GovernanceSummaryBar
      testId="people-summary-strip"
      items={[
        // A hint survives only where the label cannot say the thing itself.
        // "people" is a bare noun and the figure runs larger than the member
        // count, so the population is worth naming; "unmatched" is our word
        // rather than the reader's; "departments" counts only the ones the
        // organization created, which the tab below no longer makes obvious now
        // that it lists the discovered ones on the same table. "without a
        // department" already states its whole condition, so it carries none.
        {
          key: "people",
          value: summary.people,
          label: "people",
          hint: "Metered by the gateway or named by a source",
        },
        {
          key: "departments",
          value: summary.departments,
          label: "departments",
          hint: "The ones you created",
        },
        {
          key: "unmatched",
          value: summary.unmatched,
          label: "unmatched",
          hint: "No account is tied to them yet",
        },
        {
          key: "unassigned",
          value: summary.unassigned,
          label: "without a department",
        },
      ]}
    />
  );
}

/**
 * The page title and the actions that belong to the whole screen rather than to
 * either tab, so that switching tabs never moves them.
 *
 * The match pass and Add department appear only for a manager: the identity
 * half of this page is read on `governance:view` and written on
 * `governance:manage`.
 *
 * One outlined control, everything else ghost. Add department is the outlined
 * one because it is the only action here that creates something; the section
 * has no filled buttons at all, so the outline is what marks it out.
 */
function PeoplePageHeader({
  sampleActive,
  onToggleSample,
  canManage,
  isRunningMatch,
  onRunMatch,
  onAddDepartment,
}: {
  sampleActive: boolean;
  onToggleSample: () => void;
  canManage: boolean;
  isRunningMatch: boolean;
  onRunMatch: () => void;
  onAddDepartment: () => void;
}) {
  return (
    <HStack
      data-testid="people-page-header"
      justify="space-between"
      align="center"
      flexWrap="wrap"
      gap={2}
    >
      <Heading size="md">People</Heading>
      <HStack gap={2}>
        <SampleDataToggle
          active={sampleActive}
          onToggle={onToggleSample}
          size="sm"
        />
        {canManage && (
          <>
            {/* Ghost, so the one outlined control in this row is the create
                action beside it. */}
            <Button
              size="sm"
              variant="ghost"
              loading={isRunningMatch}
              onClick={onRunMatch}
            >
              Run match pass
            </Button>
            {/* The house header button: outline, small, leading plus. It is
                the one action here that creates something of the
                organization's own — a person arrives on this page because a
                provider named them and a match pass recomputes over what is
                already there, while a department exists only because somebody
                made it — and being the only outlined control in the row is
                what marks it out now that nothing in the section is filled.
                Rulebook: governance-ui-controls.feature. */}
            <PageLayout.HeaderButton onClick={onAddDepartment}>
              <Plus size={14} /> Add department
            </PageLayout.HeaderButton>
          </>
        )}
      </HStack>
    </HStack>
  );
}

/*
 * People tab
 */

function PeopleTabPane({
  orgId,
  reads,
  allRows,
  sampleActive,
  canReadActivity,
  canManage,
  department,
  onDepartmentChange,
  sortBy,
  onSortChange,
  onAssignDepartment,
  onSuggestionsChanged,
}: {
  orgId: string;
  reads: ReturnType<typeof usePeopleReads>;
  /** Every row the page built, before this pane's department filter. */
  allRows: PeopleRow[];
  sampleActive: boolean;
  canReadActivity: boolean;
  canManage: boolean;
  department: string | null;
  onDepartmentChange: (next: string | null) => void;
  sortBy: ReturnType<typeof useSpendSortParam>["sortBy"];
  onSortChange: ReturnType<typeof useSpendSortParam>["setSortBy"];
  onAssignDepartment: (row: PeopleRow) => void;
  onSuggestionsChanged: () => Promise<void>;
}) {
  const departments = departmentsPresent(allRows);
  const rows = filterByDepartment({ rows: allRows, department });
  const suggestions = sampleActive ? [] : (reads.suggestions.data ?? []);
  const isLoading =
    !sampleActive && (reads.spend.isLoading || reads.people.isLoading);

  if (!canReadActivity && !sampleActive) {
    return (
      <PermissionRequiredNotice
        permission="activityMonitor:view"
        detail="Spend and activity per person stay hidden until then."
      />
    );
  }

  return (
    <VStack align="stretch" gap={4} width="full">
      <PeopleFilterBar
        department={department}
        departments={departments}
        onDepartmentChange={onDepartmentChange}
        sortBy={sortBy}
        onSortChange={onSortChange}
      />

      <PeopleReadIssues sampleActive={sampleActive} reads={reads} />

      <PeopleTableSection
        rows={rows}
        isLoading={isLoading}
        department={department}
        sources={sampleActive ? undefined : reads.sources.data}
        canManage={canManage}
        onAssignDepartment={onAssignDepartment}
      />

      {suggestions.length > 0 && (
        <SuggestionsPanel
          orgId={orgId}
          suggestions={suggestions}
          canManage={canManage}
          onChanged={onSuggestionsChanged}
        />
      )}
    </VStack>
  );
}

/**
 * The one table's rows: the invented ones in sample mode, and otherwise the
 * spend ranking joined to the people the providers named.
 *
 * A hook rather than a few lines in the pane because the join needs four reads
 * and two lookups written inline, and reading the pane should not mean reading
 * the join first. Memoised on the reads it uses, so a re-render for an
 * unrelated reason does not rebuild the whole table.
 */
function usePeopleTableRows({
  sampleActive,
  reads,
}: {
  sampleActive: boolean;
  reads: ReturnType<typeof usePeopleReads>;
}) {
  return useMemo(
    () =>
      sampleActive
        ? samplePeopleRows()
        : mergePeopleRows({
            spend: reads.spend.data ?? [],
            discovered: reads.people.data ?? [],
            departmentForActor: (actor) =>
              departmentNameForActor({
                actor,
                assignments: reads.assignments.data,
                departments: reads.departments.data,
              }),
            memberNameForActor: (actor) =>
              reads.assignments.data?.users.find(
                (user) => user.email === actor || user.id === actor,
              )?.name ?? null,
          }),
    [
      sampleActive,
      reads.spend.data,
      reads.people.data,
      reads.assignments.data,
      reads.departments.data,
    ],
  );
}

/**
 * What the page says when a read did not answer: the locked line for an
 * organization whose plan does not carry spend, and otherwise whichever of the
 * two reads failed.
 *
 * Sample mode advertises invented figures; reporting that a read of the real
 * ones failed on the same screen leaves the reader unable to act on either
 * half. So sample mode says nothing here, and that one decision is the whole
 * reason this is its own component rather than three conditions in the middle
 * of the pane.
 */
function PeopleReadIssues({
  sampleActive,
  reads,
}: {
  sampleActive: boolean;
  reads: ReturnType<typeof usePeopleReads>;
}) {
  if (sampleActive) return null;
  if (reads.lockedByPlan) return <EnterpriseLockedLine />;

  return (
    <>
      <HandledErrorAlert
        error={reads.spend.error}
        fallbackTitle="Couldn't load people"
      />
      <HandledErrorAlert
        error={reads.people.error}
        fallbackTitle="Couldn't load the people the providers named"
      />
    </>
  );
}

/**
 * The table and the three things that can stand in for it: a spinner while the
 * reads are in flight, a line explaining an empty result, or the table itself
 * with a count under it.
 *
 * Separate from the pane because those three are one decision about the same
 * piece of the screen, and the pane's job is the arrangement of the pieces
 * rather than what any one of them turns out to be.
 *
 * Nothing is printed under the table but the count. The page offers no time
 * control, so its window still has to be stated — it is stated on the two
 * headings it is true of (`UnifiedPeopleTable`), and how far the ranking
 * reaches is stated in the sort menu (`PeopleFilterBar`), which is the control
 * it is true of. A paragraph under the table said both to a reader who was
 * looking at neither.
 */
function PeopleTableSection({
  rows,
  isLoading,
  department,
  sources,
  canManage,
  onAssignDepartment,
}: {
  rows: PeopleRow[];
  isLoading: boolean;
  department: string | null;
  sources: Parameters<typeof sourceForTarget>[0]["sources"];
  canManage: boolean;
  onAssignDepartment: (row: PeopleRow) => void;
}) {
  if (isLoading) {
    return (
      <Box padding={6}>
        <Spinner />
      </Box>
    );
  }

  if (rows.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={6}
        color="fg.muted"
        fontSize="sm"
      >
        {emptyPeopleLine({ department })}
      </Box>
    );
  }

  return (
    <>
      <UnifiedPeopleTable
        rows={rows}
        sourceFor={(target) => sourceForTarget({ target, sources })}
        onAssignDepartment={canManage ? onAssignDepartment : undefined}
      />
      <Text fontSize="xs" color="fg.muted">
        {rows.length} {rows.length === 1 ? "person" : "people"} shown.
      </Text>
    </>
  );
}

/**
 * Why the table is empty, said in the reader's own terms.
 *
 * Both halves of the table have to be accounted for or the sentence is a
 * half-truth: the money comes from the gateway and the names come from the
 * connected providers, so a screen with no rows means neither of them has
 * anybody. A filtered view names the department it filtered by, because
 * "nobody used AI" is alarming and wrong when the truth is that nobody in
 * Finance did.
 */
function emptyPeopleLine({ department }: { department: string | null }) {
  return department !== null
    ? `No one in ${department} has used AI through a connected source, and no connected source has named anyone in ${department}.`
    : "No one has used AI through a connected source, and no connected source has named anyone.";
}

/*
 * Departments tab
 */

function DepartmentsTabPane({
  orgId,
  rows,
  isLoading,
  error,
  canManage,
  canManageGrant,
  onChanged,
}: {
  orgId: string;
  rows: readonly DepartmentTableRow[];
  isLoading: boolean;
  error: unknown;
  /** Whether per-row actions are offered on these particular rows. */
  canManage: boolean;
  /** Whether the reader holds the grant at all, for the notice below. */
  canManageGrant: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <VStack align="stretch" gap={4} width="full">
      <Text fontSize="sm" color="fg.muted">
        Spend rolls up by department, including personal AI use.
      </Text>

      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load departments"
      />

      <DepartmentList
        orgId={orgId}
        rows={rows}
        isLoading={isLoading}
        onChanged={onChanged}
        canManage={canManage}
      />

      {!canManageGrant && (
        <PermissionRequiredNotice
          permission="governance:manage"
          detail="You can read the department list. Creating, renaming, archiving, and assigning need this grant."
        />
      )}

      <AssignmentGuide />
    </VStack>
  );
}

/**
 * The review queue: what the engine would not decide on its own. Confirming
 * is the engine spec's contract — the link it opens, the refusals for people
 * since linked or erased — this panel only reaches it.
 */
function SuggestionsPanel({
  orgId,
  suggestions,
  canManage,
  onChanged,
}: {
  orgId: string;
  suggestions: MatchSuggestion[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const confirmMutation = api.governancePeople.confirmSuggestion.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Link confirmed", type: "success" });
      await onChanged();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't confirm the link" }),
  });

  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      <Box
        paddingY={2}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
        backgroundColor="bg.subtle"
      >
        <Text
          fontSize="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          Suggested matches
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
          Assign people and teams to a department where you already manage them. Spend rolls up by
          department, including personal AI use.
=======
          Names that merely resemble a member. Nothing links until a person
          confirms it.
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
        </Text>
      </Box>
      {suggestions.map((suggestion) => (
        <HStack
          key={suggestion.id}
          paddingY={2}
          paddingX={3}
          borderBottomWidth="1px"
          borderColor="border.muted"
          fontSize="sm"
          justifyContent="space-between"
        >
          <Text minW={0} truncate>
            <Text as="span" fontWeight="medium">
              {suggestion.personDisplayText}
            </Text>{" "}
            <Text as="span" color="fg.muted">
              ({suggestion.personProvider})
            </Text>{" "}
            ≈{" "}
            <Text as="span" fontWeight="medium">
              {suggestion.memberName ?? suggestion.userId}
            </Text>
          </Text>
          {canManage && (
            <Button
              size="xs"
              variant="outline"
              loading={
                confirmMutation.isPending &&
                confirmMutation.variables?.suggestionId === suggestion.id
              }
              onClick={() =>
                confirmMutation.mutate({
                  organizationId: orgId,
                  suggestionId: suggestion.id,
                })
              }
            >
              Confirm
            </Button>
          )}
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Where a department gets assigned, collapsed by default: the list is the
 * point of the tab, and the guide is for the first time someone wonders why
 * a row says Unassigned.
 */
function AssignmentGuide() {
  return (
    <Collapsible.Root>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        overflow="hidden"
      >
        <Collapsible.Trigger asChild>
          <HStack
            as="button"
            width="full"
            justifyContent="space-between"
            paddingY={2}
            paddingX={3}
            backgroundColor="bg.subtle"
            cursor="pointer"
            _hover={{ backgroundColor: "bg.muted" }}
          >
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              How departments are assigned
            </Text>
            <Box color="fg.muted" display="flex">
              <ChevronDown size={16} aria-hidden="true" />
            </Box>
          </HStack>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <VStack align="stretch" gap={0}>
            <AssignmentLink
              href="/settings/members"
              title="People"
              description="A person's spend, including personal AI use, rolls up to their department. Assign each member from the members page, or from the row action on the People tab."
            />
            <AssignmentLink
              href="/settings/teams"
              title="Teams"
              description="A team department is the default its members and projects inherit when they have none of their own. Assign each team from the teams page."
            />
            <AssignmentLink
              href="/settings/teams"
              title="Projects"
              description="A project is where an autonomous agent runs. Agent spend with no human principal rolls up to the project's department. Assign each project from the teams page, next to its team."
            />
          </VStack>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
}

function AssignmentLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} variant="plain">
      <HStack
        paddingY={3}
        paddingX={3}
        borderTopWidth="1px"
        borderColor="border.muted"
        justifyContent="space-between"
        color="fg.muted"
        _hover={{ backgroundColor: "bg.muted" }}
      >
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium" color="blue.600">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted" maxW="2xl">
            {description}
          </Text>
        </VStack>
        <ExternalLink size={16} />
      </HStack>
    </Link>
  );
}

function DepartmentList({
  orgId,
  rows,
  isLoading,
  onChanged,
  canManage,
}: {
  orgId: string;
  rows: readonly DepartmentTableRow[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
  canManage: boolean;
}) {
<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const [editing, setEditing] = useState<Department | null>(null);
  const [archiving, setArchiving] = useState<Department | null>(null);
=======
  const [editing, setEditing] = useState<DepartmentRecord | null>(null);
  const [archiving, setArchiving] = useState<DepartmentRecord | null>(null);
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx

  const archiveMutation = api.departments.archive.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Department archived", type: "success" });
      setArchiving(null);
      await onChanged();
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't archive department",
      }),
  });

  return (
    <>
      <DepartmentListPanel
        rows={rows}
        isLoading={isLoading}
        canManage={canManage}
        onRename={setEditing}
        onArchive={setArchiving}
      />

      <DepartmentEditDrawer
        organizationId={orgId}
        department={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          void onChanged();
        }}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Archive ${archiving?.name ?? "department"}?`}
        message="Spend already attributed to this department rolls up under Unassigned. The department stops appearing in the assignment pickers."
        confirmLabel="Archive"
        tone="warning"
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (archiving) {
            archiveMutation.mutate({ organizationId: orgId, id: archiving.id });
          }
        }}
      />
    </>
  );
}

/**
 * The one departments table: a header carrying the count, and a row per
 * department, whether the organization created it or a connected directory
 * named it.
 *
 * There were two of these stacked on each other until the reader had to work
 * out for themselves why "Engineering" was printed twice on one screen. The
 * distinction that earned the second table is now a badge on the row saying
 * which provider named it, and nothing else — no heading of its own, no
 * paragraph explaining the split, because there is no split left to explain.
 * `mergeDepartmentRows` owns what happens when both name the same department.
 *
 * Separate from the component above only because that one also owns the rename
 * drawer and the archive confirmation, and holding a table, a drawer and a
 * dialog in one body made the table hard to find among them. Nothing here
 * decides anything — it renders what it is handed and reports which row the
 * reader picked.
 */
function DepartmentListPanel({
  rows,
  isLoading,
  canManage,
  onRename,
  onArchive,
}: {
  rows: readonly DepartmentTableRow[];
  isLoading: boolean;
  canManage: boolean;
  onRename: (department: DepartmentRecord) => void;
  onArchive: (department: DepartmentRecord) => void;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      <HStack
        paddingY={2}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
        backgroundColor="bg.subtle"
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
        justifyContent="space-between"
      >
        <HStack gap={2} minWidth={0}>
          <Text>Departments</Text>
          {!isLoading && (
            <Text
              fontWeight="normal"
              textTransform="none"
              letterSpacing="normal"
            >
              {rows.length}
            </Text>
          )}
        </HStack>
        {/* The figure on each row counts the people a connected source filed
            under that name. That is not the department's membership: an
            administrator can assign people no source ever named, and
            `directoryHeadcount` never counts those. Saying so is what lets the
            em dash read as "no source named anyone here" instead of as an empty
            department — the panel this table replaced carried that fact in its
            heading, and deleting the panel would otherwise have deleted it. */}
        <Text flexShrink={0}>People named by a source</Text>
      </HStack>
      {isLoading ? (
        <Box padding={4}>
          <Spinner />
        </Box>
      ) : rows.length === 0 ? (
        <Box padding={4} color="fg.muted" fontSize="sm">
          {canManage
            ? "No departments yet. Create one to start attributing spend."
            : "No departments yet."}
        </Box>
      ) : (
        rows.map((row) => (
          <DepartmentRow
            key={row.key}
            row={row}
            onRename={() => row.record && onRename(row.record)}
            onArchive={() => row.record && onArchive(row.record)}
            canManage={canManage}
          />
        ))
      )}
    </VStack>
  );
}

function DepartmentRow({
  row,
  onRename,
  onArchive,
  canManage,
}: {
  row: DepartmentTableRow;
  onRename: () => void;
  onArchive: () => void;
  canManage: boolean;
}) {
  // Rename and Archive act on a `Department` record. A row a directory named
  // and nobody created is not one — there is no row to rename and nothing to
  // archive — so it is offered neither, which is the same rule the separate
  // panel used to enforce by being a separate panel.
  const actionable = canManage && row.record !== null;

  return (
    <HStack
      data-testid={`department-row-${row.name}`}
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      justifyContent="space-between"
      gap={3}
    >
      <HStack gap={2} minWidth={0}>
        <Text fontWeight="medium" truncate>
          {row.name}
        </Text>
        {row.providers.map((provider) => (
          <Badge
            key={provider}
            size="sm"
            variant="surface"
            colorPalette="gray"
            flexShrink={0}
          >
            {providerLabel(provider)}
          </Badge>
        ))}
      </HStack>
      <HStack gap={2} flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {directoryHeadcount(row)}
        </Text>
        {actionable && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Actions for ${row.name}`}
              >
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="rename" onClick={onRename}>
                <Pencil size={14} /> Rename
              </Menu.Item>
              <Menu.Item value="archive" color="red.500" onClick={onArchive}>
                <Archive size={14} /> Archive
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </HStack>
    </HStack>
  );
}

<<<<<<< HEAD:enterprise/modules/governance/web/src/ui/sections/governance/governance-people.screen.tsx
export default PeoplePage;
=======
/**
 * How many people the connected directories filed under this department.
 *
 * An em dash where no directory named it, never "0 people": the figure counts
 * the directories' people and not the members an administrator assigned, so a
 * zero beside a department somebody created would report it empty when it may
 * hold half the company. We did not measure that, and the dash says so.
 */
function directoryHeadcount(row: DepartmentTableRow): string {
  if (row.directoryPeopleCount === null) return "—";
  return row.directoryPeopleCount === 1
    ? "1 person"
    : `${row.directoryPeopleCount} people`;
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(PeoplePage),
);
>>>>>>> origin/main:platform/app/src/pages/governance/people.tsx
