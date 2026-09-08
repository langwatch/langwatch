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
  useSettledRealDataState,
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

function PeoplePage() {
  const { tab, selectTab } = usePeopleTab();
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("governance:manage");

  const { sortBy, setSortBy } = useSpendSortParam();
  const { frame, department, setFrame, setDepartment } = usePeopleFilters();
  const windowDays = spendWindowDays({ frame });

  const reads = usePeopleReads({
    orgId,
    windowDays,
    sortBy,
    canReadActivity,
    canReadSources,
  });

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

  const runMatch = api.governancePeople.runMatch.useMutation({
    onSuccess: async (outcome) => {
      toaster.create({
        title: "Match pass finished",
        description: `${outcome.linked} linked, ${outcome.unproven} unproven. Suggestions refresh as pull sources deliver people.`,
        type: "success",
      });
      await refreshIdentity();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't run the match pass" }),
  });

  /**
   * Sample data fills a page with nothing on it. The three reads that decide
   * are the ones a reader would call "something to look at": the money, the
   * people the providers named, and the departments the organization keeps.
   */
  const sample = useSampleMode({
    realData: useSettledRealDataState([
      reads.spend.data ?? null,
      reads.people.data ?? null,
      reads.departments.data ?? null,
    ]),
  });

  const [addingDepartment, setAddingDepartment] = useState(false);
  const [assigning, setAssigning] = useState<PeopleRow | null>(null);

  const departmentsList: DepartmentListItem[] = sample.active
    ? SAMPLE_DEPARTMENTS.map((name, index) => ({
        id: `sample-department-${index}`,
        name,
      }))
    : (reads.departments.data ?? []);

  const observed: ObservedDepartment[] = sample.active
    ? SAMPLE_DEPARTMENTS.map((name, index) => ({
        name,
        peopleCount: 4 - index,
      }))
    : groupObservedDepartments(reads.people.data ?? []);

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
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
              active={sample.active}
              onToggle={sample.toggle}
              size="sm"
            />
            {canManage && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  loading={runMatch.isPending}
                  onClick={() => runMatch.mutate({ organizationId: orgId })}
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
                <Button
                  size="sm"
                  colorPalette="orange"
                  onClick={() => setAddingDepartment(true)}
                >
                  <Plus size={14} /> Add department
                </Button>
              </>
            )}
          </HStack>
        </HStack>

        {sample.active && (
          <SampleDataBanner>
            These people and departments are illustrations of what this page
            shows once a source has delivered rows — nothing here is real.
          </SampleDataBanner>
        )}

        <Tabs.Root
          value={tab}
          onValueChange={({ value }) => selectTab(value)}
          variant="line"
          lazyMount
        >
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
          <Tabs.Content value="people" paddingTop={4}>
            <PeopleTabPane
              orgId={orgId}
              reads={reads}
              sampleActive={sample.active}
              canReadActivity={canReadActivity}
              canManage={canManage}
              frame={frame}
              onFrameChange={setFrame}
              department={department}
              onDepartmentChange={setDepartment}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onAssignDepartment={setAssigning}
              onSuggestionsChanged={refreshIdentity}
            />
          </Tabs.Content>
          <Tabs.Content value="departments" paddingTop={4}>
            <DepartmentsTabPane
              orgId={orgId}
              departments={departmentsList}
              observed={observed}
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

      <AddDepartmentDialog
        orgId={orgId}
        open={addingDepartment}
        onClose={() => setAddingDepartment(false)}
        onCreated={refreshDepartments}
      />
      <AssignDepartmentDialog
        orgId={orgId}
        personName={assigning?.displayName ?? ""}
        userId={assigning?.linkedUserId ?? null}
        currentDepartmentId={null}
        departments={reads.departments.data ?? []}
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        onAssigned={refreshAssignments}
      />
    </GovernanceLayout>
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
  const allRows = useMemo(
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

  const frameLabel = timeFrameLabel(frame).toLowerCase();

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

      {/* Sample mode advertises invented figures; reporting that a read of the
          real ones failed on the same screen leaves the reader unable to act on
          either half. */}
      {!sampleActive && reads.lockedByPlan && <EnterpriseLockedLine />}
      {!sampleActive && !reads.lockedByPlan && (
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
      )}

      {isLoading ? (
        <Box padding={6}>
          <Spinner />
        </Box>
      ) : rows.length === 0 ? (
        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          padding={6}
          color="fg.muted"
          fontSize="sm"
        >
          {department !== null
            ? `Nobody in ${department} used AI through a connected source in the ${frameLabel}.`
            : `No one has used AI through a connected source in the ${frameLabel}.`}
        </Box>
      ) : (
        <>
          <UnifiedPeopleTable
            rows={rows}
            sourceFor={(target) =>
              sourceForTarget({ target, sources: reads.sources.data })
            }
            onAssignDepartment={canManage ? onAssignDepartment : undefined}
          />
          <Text fontSize="xs" color="fg.muted">
            {rows.length} {rows.length === 1 ? "person" : "people"} shown.
            {isFrameClamped({ frame })
              ? " Spend and requests are measured over the last 365 days, the longest window this read answers."
              : ""}
          </Text>
        </>
      )}

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
            <Text
              fontWeight="normal"
              textTransform="none"
              letterSpacing="normal"
            >
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
              onRename={() => setEditing(dept)}
              onArchive={() => setArchiving(dept)}
              canManage={canManage}
            />
          ))
        )}
      </VStack>

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
