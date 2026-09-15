// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  MoreVertical,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { SpendSortField } from "@langwatch/enterprise-governance-contract";

import { api, type RouterOutputs } from "../../../behavior/governance-api.ts";
import {
  useGovernancePlan,
  useGovernanceScope,
} from "../../../behavior/governance-session.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../behavior/governance-feedback.ts";
import { useGovernanceSearchParams } from "../../../behavior/governance-router.ts";
import { DepartmentEditDrawer } from "../../../features/departments/ui/sections/department-edit-drawer.tsx";
import { AssignDepartmentDialog } from "../../../features/people/ui/assign-department-dialog.tsx";
import { CreateDepartmentDrawer } from "../../../features/people/ui/create-department-drawer.tsx";
import {
  type DepartmentRecord,
  type DepartmentTableRow,
  mergeDepartmentRows,
} from "../../../features/people/model/department-rows.ts";
import { groupObservedDepartments } from "../../../features/people/model/observed-departments.ts";
import { PeopleFilterBar } from "../../../features/people/ui/people-filter-bar.tsx";
import {
  SPEND_WINDOW_DAYS,
  usePeopleFilters,
} from "../../../features/people/model/people-filters.ts";
import {
  departmentsPresent,
  filterByDepartment,
  mergePeopleRows,
  type PeopleRow,
} from "../../../features/people/model/people-rows.ts";
import { summarizePeople } from "../../../features/people/model/people-summary.ts";
import {
  SAMPLE_DEPARTMENTS,
  samplePeopleRows,
} from "../../../features/people/model/sample-people.ts";
import {
  departmentNameForActor,
  EnterpriseLockedLine,
  sourceForTarget,
} from "../../../features/people/ui/people-table.tsx";
import {
  providerLabel,
  UnifiedPeopleTable,
} from "../../../features/people/ui/unified-people-table.tsx";
import { readHandledError } from "../../../model/handled-error.ts";
import {
  SampleDataBanner,
  SampleDataToggle,
} from "../../../ui/elements/sample-data-controls.tsx";
import { useSampleMode } from "../../../ui/elements/governance-sample-mode.ts";
import { GovernanceSummaryBar } from "../../../ui/elements/governance-summary-bar.tsx";
import { HandledErrorAlert } from "../../../ui/elements/handled-error-alert.tsx";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";

type Department = RouterOutputs["departments"]["list"][number];
/**
 * All the department list renders. Narrower than the stored row on purpose:
 * sample mode supplies invented departments that have no record behind them.
 */
type DepartmentListItem = Pick<Department, "id" | "name">;
type MatchSuggestion = RouterOutputs["governancePeople"]["suggestions"][number];

/**
 * The People page: everyone who used AI through a connected source and
 * everyone the connected providers named, on one table, and every department
 * either the organization or a connected directory names, on a second tab.
 *
 * `mergePeopleRows` joins the spend ranking and the identity feed timidly:
 * two providers naming the same address stay two rows, because deciding they
 * are the same human is the match engine's job, never a table's.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/governance/governance-people-screen.feature
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
const PEOPLE_TABS = ["people", "departments"] as const;
type PeopleTab = (typeof PEOPLE_TABS)[number];
const DEFAULT_TAB: PeopleTab = "people";

const isPeopleTab = (value: string | null): value is PeopleTab =>
  PEOPLE_TABS.some((tab) => tab === value);

/**
 * A selected non-default tab is part of the address; the default stays out,
 * and an unknown value degrades to the default rather than a blank pane.
 */
function usePeopleTab() {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
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

const SPEND_SORT_FIELDS: readonly SpendSortField[] = [
  "spend",
  "requests",
  "lastActivity",
];
const isSpendSortField = (value: string | null): value is SpendSortField =>
  SPEND_SORT_FIELDS.some((field) => field === value);

/**
 * The people ranking's sort, in the address (`?sort=requests`) alongside the
 * tab and the department — every other parameter is preserved.
 */
function usePeopleSpendSort(): {
  sortBy: SpendSortField;
  setSortBy: (next: SpendSortField) => void;
} {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
  const requested = searchParams.get("sort");
  const sortBy: SpendSortField = isSpendSortField(requested)
    ? requested
    : "spend";
  const setSortBy = (next: SpendSortField) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "spend") params.delete("sort");
        else params.set("sort", next);
        return params;
      },
      { replace: true },
    );
  return { sortBy, setSortBy };
}

/**
 * Every read the page makes, in one place: the sample decision and the
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
  sortBy: SpendSortField;
  canReadActivity: boolean;
  canReadSources: boolean;
}) {
  // The spend read is Enterprise-gated server-side and answers with a bare
  // refusal, so the plan is checked here first: a non-Enterprise organization
  // gets the locked line without a request that can only fail.
  const { isEnterprise, isLoading: isPlanLoading } = useGovernancePlan();
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
 * Every read the page invalidates after a write. A caller says what changed,
 * not which queries that touches.
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
 * Running a match pass over the people the providers named. What the pass
 * found is reported as a toast, since nothing on screen changes until the
 * identity reads come back.
 */
function useRunMatchPass({
  orgId,
  onFinished,
}: {
  orgId: string;
  onFinished: () => Promise<void>;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
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
  });

  return {
    isRunning: mutation.isPending,
    run: () => mutation.mutate({ organizationId: orgId }),
  };
}

/**
 * The Departments tab's one list, and the figure the summary strip counts —
 * built together so the tab and the strip can never disagree.
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
 * The one table's rows: invented in sample mode, otherwise the spend ranking
 * joined to the people the providers named.
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
              reads.assignments.data?.users.find((user) => user.id === actor)
                ?.name ?? null,
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
 * Everything the page has to settle before it can render anything: the
 * organization, its grants, the filters and sort, the reads those decide, and
 * the rows those reads come out as.
 */
function usePeopleScreen() {
  const { organization, hasAnyPermission } = useGovernanceScope();
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("governance:manage");

  const spendSort = usePeopleSpendSort();
  const filters = usePeopleFilters();

  const reads = usePeopleReads({
    orgId,
    // Fixed: the page offers no window to pick, and the read has no
    // unbounded mode. The table says which window it read.
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

  const departmentTab = departmentTabRows({
    sampleActive: sample.active,
    reads,
  });
  // Built once, here, so the strip above the tabs and the table inside them
  // can never report different populations.
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

  const [assigning, setAssigning] = useState<PeopleRow | null>(null);
  // Main opened this from a URL-routed drawer singleton this branch has no
  // host for (see the merge handoff); local state opens it instead.
  const [creatingDepartment, setCreatingDepartment] = useState(false);

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <PeoplePageHeader
          sampleActive={sample.active}
          onToggleSample={sample.toggle}
          canManage={canManage}
          isRunningMatch={runMatch.isRunning}
          onRunMatch={runMatch.run}
          onAddDepartment={() => setCreatingDepartment(true)}
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

      <CreateDepartmentDrawer
        organizationId={screen.orgId}
        open={creatingDepartment}
        onOpenChange={setCreatingDepartment}
        onCreated={screen.refreshers.refreshDepartments}
      />
    </GovernanceLayout>
  );
}

/**
 * The tab shell and both panes. Takes the settled screen whole rather than
 * fifteen props that would all pass straight through unchanged.
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

/** The two tab triggers, factored out so the styling repeats only once. */
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

/** The line saying the figures below are invented. */
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
 * The resume above the tabs: four figures counted off rows the page has
 * already read, so the strip can never disagree with the table under it. A
 * read that has not answered leaves its figure unmeasured (an em dash), never
 * a lying zero.
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
 * The page title and the actions for the whole screen. Match pass and Add
 * department appear only for a manager: the identity half of this page reads
 * on `governance:view` and writes on `governance:manage`.
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
            <Button
              size="sm"
              variant="ghost"
              loading={isRunningMatch}
              onClick={onRunMatch}
            >
              Run match pass
            </Button>
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
  sortBy: SpendSortField;
  onSortChange: (next: SpendSortField) => void;
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
 * What the page says when a read did not answer. Sample mode says nothing
 * here — reporting a failed real read beside invented figures leaves the
 * reader unable to act on either half.
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
 * The table and the three things that can stand in for it: a spinner while
 * loading, a line explaining an empty result, or the table with a count
 * under it.
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
 * Why the table is empty, in the reader's own terms: the money comes from the
 * gateway and the names come from the connected providers, so no rows means
 * neither of them has anybody.
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
 * is the engine spec's contract — this panel only reaches it.
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
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
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
          Names that merely resemble a member. Nothing links until a person
          confirms it.
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
 * point of the tab, the guide is for the first "why is this Unassigned".
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
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const [editing, setEditing] = useState<DepartmentRecord | null>(null);
  const [archiving, setArchiving] = useState<DepartmentRecord | null>(null);

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
 * The one departments table: a header carrying the count, a row per
 * department, whichever named it. `mergeDepartmentRows` owns what happens
 * when both a created record and a directory name it the same.
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
  // A row a directory named and nobody created has no record to rename or
  // archive, so it is offered neither.
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

/**
 * How many people the connected directories filed under this department. An
 * em dash where none named it, never "0 people" — this counts the
 * directories' people, not the members an administrator assigned.
 */
function directoryHeadcount(row: DepartmentTableRow): string {
  if (row.directoryPeopleCount === null) return "—";
  return row.directoryPeopleCount === 1
    ? "1 person"
    : `${row.directoryPeopleCount} people`;
}

export default PeoplePage;
