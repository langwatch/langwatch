import {
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
import {
  groupObservedDepartments,
  type ObservedDepartment,
} from "@ee/governance/services/logic/observedDepartments";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  MoreVertical,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { timeFrameLabel } from "~/components/governance/filters";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  departmentNameForActor,
  EnterpriseLockedLine,
  sourceForTarget,
} from "~/components/governance/PeopleTable";
import { AddDepartmentDialog } from "~/components/governance/people/AddDepartmentDialog";
import { AssignDepartmentDialog } from "~/components/governance/people/AssignDepartmentDialog";
import { PeopleFilterBar } from "~/components/governance/people/PeopleFilterBar";
import {
  isFrameClamped,
  spendWindowDays,
  usePeopleFilters,
} from "~/components/governance/people/peopleFilters";
import {
  departmentsPresent,
  filterByDepartment,
  mergePeopleRows,
  type PeopleRow,
} from "~/components/governance/people/peopleRows";
import {
  SAMPLE_DEPARTMENTS,
  samplePeopleRows,
} from "~/components/governance/people/samplePeople";
import { UnifiedPeopleTable } from "~/components/governance/people/UnifiedPeopleTable";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode,
} from "~/components/governance/sample";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { DepartmentEditDrawer } from "~/components/settings/DepartmentEditDrawer";
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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSpendSortParam } from "~/hooks/useSpendSortParam";
import { api, type RouterOutputs } from "~/utils/api";

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
 * the connected providers named, on one table, and the departments that spend
 * rolls up to on a second tab.
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
const PEOPLE_TABS = ["people", "departments"] as const;
type PeopleTab = (typeof PEOPLE_TABS)[number];
const DEFAULT_TAB: PeopleTab = "people";

const isPeopleTab = (value: string | null): value is PeopleTab =>
  PEOPLE_TABS.some((tab) => tab === value);

/**
 * A selected non-default tab is part of the address; the default stays out
 * of it, and an unknown value degrades to the default instead of a blank
 * pane. Every other parameter (the sort, the frame, the department) is
 * preserved.
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
 * they have filtered and sorted to, and the reads that all of that decides.
 *
 * Gathered here because the answers depend on one another — the window comes
 * from the frame, the reads come from the window and the grants — and reading
 * the page body should not mean reading that chain first.
 */
function usePeopleScreen() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
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
    windowDays: spendWindowDays({ frame: filters.frame }),
    sortBy: spendSort.sortBy,
    canReadActivity,
    canReadSources,
  });

  return { orgId, canReadActivity, canManage, spendSort, filters, reads };
}

function PeoplePage() {
  const { tab, selectTab } = usePeopleTab();
  const { orgId, canReadActivity, canManage, spendSort, filters, reads } =
    usePeopleScreen();

  const { refreshDepartments, refreshIdentity, refreshAssignments } =
    usePeopleRefreshers({ orgId });

  const runMatch = useRunMatchPass({ orgId, onFinished: refreshIdentity });
  const sample = useSampleMode();

  const [addingDepartment, setAddingDepartment] = useState(false);
  const [assigning, setAssigning] = useState<PeopleRow | null>(null);

  const departmentTab = departmentTabRows({
    sampleActive: sample.active,
    reads,
  });

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <PeoplePageHeader
          sampleActive={sample.active}
          onToggleSample={sample.toggle}
          canManage={canManage}
          isRunningMatch={runMatch.isRunning}
          onRunMatch={runMatch.run}
          onAddDepartment={() => setAddingDepartment(true)}
        />

        <PeopleSampleBanner active={sample.active} />

        <Tabs.Root
          value={tab}
          onValueChange={({ value }) => selectTab(value)}
          variant="line"
          lazyMount
        >
          <PeopleTabsList />
          <Tabs.Content value="people" paddingTop={4}>
            <PeopleTabPane
              orgId={orgId}
              reads={reads}
              sampleActive={sample.active}
              canReadActivity={canReadActivity}
              canManage={canManage}
              frame={filters.frame}
              onFrameChange={filters.setFrame}
              department={filters.department}
              onDepartmentChange={filters.setDepartment}
              sortBy={spendSort.sortBy}
              onSortChange={spendSort.setSortBy}
              onAssignDepartment={setAssigning}
              onSuggestionsChanged={refreshIdentity}
            />
          </Tabs.Content>
          <Tabs.Content value="departments" paddingTop={4}>
            <DepartmentsTabPane
              orgId={orgId}
              departments={departmentTab.departments}
              observed={departmentTab.observed}
              isLoading={!sample.active && reads.departments.isLoading}
              error={sample.active ? null : reads.departments.error}
              // Invented rows carry no record to rename or archive.
              canManage={canManage && !sample.active}
              canManageGrant={canManage}
              onChanged={refreshDepartments}
            />
          </Tabs.Content>
        </Tabs.Root>
      </VStack>

      <PeopleDialogs
        orgId={orgId}
        addingDepartment={addingDepartment}
        onCloseAddDepartment={() => setAddingDepartment(false)}
        onDepartmentCreated={refreshDepartments}
        assigning={assigning}
        onCloseAssign={() => setAssigning(null)}
        onAssigned={refreshAssignments}
        departments={reads.departments.data ?? []}
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
 * Both lists the Departments tab shows: the organization's own departments, and
 * the ones the connected providers name.
 *
 * The two are worked out together because sample mode has to answer for both at
 * once — a screen showing invented departments alongside a real observed list,
 * or the reverse, would be telling the reader two different stories. The
 * invented shapes are built by hand: a sample department is a name with nothing
 * behind it, so the identifiers are made up here to give the list something to
 * key rows by, and the observed counts descend so the panel reads like a real
 * directory rather than a row of identical numbers.
 */
function departmentTabRows({
  sampleActive,
  reads,
}: {
  sampleActive: boolean;
  reads: ReturnType<typeof usePeopleReads>;
}): {
  departments: readonly DepartmentListItem[];
  observed: ObservedDepartment[];
} {
  if (!sampleActive) {
    return {
      departments: reads.departments.data ?? [],
      observed: groupObservedDepartments(reads.people.data ?? []),
    };
  }

  return {
    departments: SAMPLE_DEPARTMENTS.map((name, index) => ({
      id: `sample-department-${index}`,
      name,
    })),
    observed: SAMPLE_DEPARTMENTS.map((name, index) => ({
      name,
      peopleCount: 4 - index,
    })),
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
 * The page title and the actions that belong to the whole screen rather than to
 * either tab, so that switching tabs never moves them.
 *
 * The match pass and Add department appear only for a manager: the identity
 * half of this page is read on `governance:view` and written on
 * `governance:manage`.
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
              variant="outline"
              loading={isRunningMatch}
              onClick={onRunMatch}
            >
              Run match pass
            </Button>
            {/* Solid, because it is the one action here that creates
                something of the organization's own. A person arrives on
                this page because a provider named them and a match pass
                recomputes over what is already there; a department exists
                only because somebody made it. Orange rather than the
                default grey, matching Inventory's Add tool, so the
                section's create actions look like one another. */}
            <Button size="sm" colorPalette="orange" onClick={onAddDepartment}>
              <Plus size={14} /> Add department
            </Button>
          </>
        )}
      </HStack>
    </HStack>
  );
}

/**
 * The two dialogs the header and the table open. They live outside the tabs,
 * because a dialog mounted inside a tab pane would be torn down the moment the
 * reader switched tabs underneath it.
 *
 * Which person is being assigned is the open/closed state as well: a row picked
 * means the dialog is open, and no row means it is not.
 */
function PeopleDialogs({
  orgId,
  addingDepartment,
  onCloseAddDepartment,
  onDepartmentCreated,
  assigning,
  onCloseAssign,
  onAssigned,
  departments,
}: {
  orgId: string;
  addingDepartment: boolean;
  onCloseAddDepartment: () => void;
  onDepartmentCreated: () => Promise<void>;
  assigning: PeopleRow | null;
  onCloseAssign: () => void;
  onAssigned: () => Promise<void>;
  departments: Department[];
}) {
  return (
    <>
      <AddDepartmentDialog
        orgId={orgId}
        open={addingDepartment}
        onClose={onCloseAddDepartment}
        onCreated={onDepartmentCreated}
      />
      <AssignDepartmentDialog
        orgId={orgId}
        personName={assigning?.displayName ?? ""}
        userId={assigning?.linkedUserId ?? null}
        currentDepartmentId={null}
        departments={departments}
        open={assigning !== null}
        onClose={onCloseAssign}
        onAssigned={onAssigned}
      />
    </>
  );
}

/*
 * People tab
 */

function PeopleTabPane({
  orgId,
  reads,
  sampleActive,
  canReadActivity,
  canManage,
  frame,
  onFrameChange,
  department,
  onDepartmentChange,
  sortBy,
  onSortChange,
  onAssignDepartment,
  onSuggestionsChanged,
}: {
  orgId: string;
  reads: ReturnType<typeof usePeopleReads>;
  sampleActive: boolean;
  canReadActivity: boolean;
  canManage: boolean;
  frame: Parameters<typeof timeFrameLabel>[0];
  onFrameChange: (next: Parameters<typeof timeFrameLabel>[0]) => void;
  department: string | null;
  onDepartmentChange: (next: string | null) => void;
  sortBy: ReturnType<typeof useSpendSortParam>["sortBy"];
  onSortChange: ReturnType<typeof useSpendSortParam>["setSortBy"];
  onAssignDepartment: (row: PeopleRow) => void;
  onSuggestionsChanged: () => Promise<void>;
}) {
  const allRows = usePeopleTableRows({ sampleActive, reads });

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
        frame={frame}
        onFrameChange={onFrameChange}
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
        frame={frame}
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
 */
function PeopleTableSection({
  rows,
  isLoading,
  frame,
  department,
  sources,
  canManage,
  onAssignDepartment,
}: {
  rows: PeopleRow[];
  isLoading: boolean;
  frame: Parameters<typeof timeFrameLabel>[0];
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
        {emptyPeopleLine({ frame, department })}
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
        {isFrameClamped({ frame })
          ? " Spend and requests are measured over the last 365 days, the longest window this read answers."
          : ""}
      </Text>
    </>
  );
}

/**
 * Why the table is empty, said in the reader's own terms: a filtered view names
 * the department it filtered by, because "nobody used AI" is alarming and wrong
 * when the truth is that nobody in Finance did.
 */
function emptyPeopleLine({
  frame,
  department,
}: {
  frame: Parameters<typeof timeFrameLabel>[0];
  department: string | null;
}) {
  const frameLabel = timeFrameLabel(frame).toLowerCase();
  return department !== null
    ? `Nobody in ${department} used AI through a connected source in the ${frameLabel}.`
    : `No one has used AI through a connected source in the ${frameLabel}.`;
}

/*
 * Departments tab
 */

function DepartmentsTabPane({
  orgId,
  departments,
  observed,
  isLoading,
  error,
  canManage,
  canManageGrant,
  onChanged,
}: {
  orgId: string;
  departments: readonly DepartmentListItem[];
  observed: ObservedDepartment[];
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

      <ObservedDepartmentsPanel observed={observed} />

      <DepartmentList
        orgId={orgId}
        departments={departments}
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
 * The departments the connected providers actually name, with how many people
 * each one covers.
 *
 * A separate panel from "Departments" below, not a merge into it, and the
 * separation is the honest shape rather than a shortcut. That panel is the
 * organization's own `Department` list: every row was created by an
 * administrator, spend rolls up by it, and each row can be renamed and
 * archived. These names are free text a provider asserted, mostly about people
 * who hold no LangWatch account. Listing them together would offer Rename and
 * Archive on rows that are not records at all, and quietly redefine what the
 * spend list means.
 *
 * Hidden when the providers name none — an empty panel would suggest the
 * directory was read and came back blank, which is the same picture as a
 * directory that was never switched on.
 */
function ObservedDepartmentsPanel({
  observed,
}: {
  observed: ObservedDepartment[];
}) {
  if (observed.length === 0) return null;

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
          Departments the providers see
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
          What the connected directories call these people. Create the ones you
          want to attribute spend by — spend rolls up by your own departments,
          not by these.
        </Text>
      </Box>
      {observed.map((department) => (
        <HStack
          key={department.name}
          paddingY={2}
          paddingX={3}
          borderBottomWidth="1px"
          borderColor="border.muted"
          fontSize="sm"
          justifyContent="space-between"
        >
          <Text fontWeight="medium">{department.name}</Text>
          <Text fontSize="xs" color="fg.muted">
            {department.peopleCount === 1
              ? "1 person"
              : `${department.peopleCount} people`}
          </Text>
        </HStack>
      ))}
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
  departments,
  isLoading,
  onChanged,
  canManage,
}: {
  orgId: string;
  departments: readonly DepartmentListItem[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<DepartmentListItem | null>(null);
  const [archiving, setArchiving] = useState<DepartmentListItem | null>(null);

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
        departments={departments}
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
 * The bordered list itself: a header carrying the count, and a row per
 * department.
 *
 * Separate from the component above only because that one also owns the rename
 * drawer and the archive confirmation, and holding a list, a drawer and a
 * dialog in one body made the list hard to find among them. Nothing here
 * decides anything — it renders what it is handed and reports which row the
 * reader picked.
 */
function DepartmentListPanel({
  departments,
  isLoading,
  canManage,
  onRename,
  onArchive,
}: {
  departments: readonly DepartmentListItem[];
  isLoading: boolean;
  canManage: boolean;
  onRename: (department: DepartmentListItem) => void;
  onArchive: (department: DepartmentListItem) => void;
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
        <Text>Departments</Text>
        {!isLoading && (
          <Text fontWeight="normal" textTransform="none" letterSpacing="normal">
            {departments.length}
          </Text>
        )}
      </HStack>
      {isLoading ? (
        <Box padding={4}>
          <Spinner />
        </Box>
      ) : departments.length === 0 ? (
        <Box padding={4} color="fg.muted" fontSize="sm">
          {canManage
            ? "No departments yet. Create one to start attributing spend."
            : "No departments yet."}
        </Box>
      ) : (
        departments.map((dept) => (
          <DepartmentRow
            key={dept.id}
            department={dept}
            onRename={() => onRename(dept)}
            onArchive={() => onArchive(dept)}
            canManage={canManage}
          />
        ))
      )}
    </VStack>
  );
}

function DepartmentRow({
  department,
  onRename,
  onArchive,
  canManage,
}: {
  department: DepartmentListItem;
  onRename: () => void;
  onArchive: () => void;
  canManage: boolean;
}) {
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      justifyContent="space-between"
    >
      <Text fontWeight="medium">{department.name}</Text>
      {canManage && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Actions for ${department.name}`}
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
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(PeoplePage),
);
