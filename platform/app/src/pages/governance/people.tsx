import {
  Badge,
  Box,
  Button,
  Collapsible,
  Heading,
  HStack,
  Input,
  Spinner,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MATCH_EVIDENCE_KIND } from "@ee/governance/services/logic/identityEvidence";
import {
  departmentLabelFor,
  groupObservedDepartments,
} from "@ee/governance/services/logic/observedDepartments";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { PeopleSpendPanel } from "~/components/governance/PeopleTable";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { DepartmentEditDrawer } from "~/components/settings/DepartmentEditDrawer";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSpendSortParam } from "~/hooks/useSpendSortParam";
import { api, type RouterOutputs } from "~/utils/api";

type Department = RouterOutputs["departments"]["list"][number];
type DiscoveredPerson = RouterOutputs["governancePeople"]["list"][number];
type MatchSuggestion = RouterOutputs["governancePeople"]["suggestions"][number];

/**
 * The People page: who used AI through a connected source, ranked by spend,
 * and the departments that spend rolls up to. Two tabs, one address each
 * (`?tab=people` is the default and stays out of the address).
 *
 * The page opens on `governance:view`. The People tab reads spend with
 * `activityMonitor:view` and says so when the viewer lacks it. Departments
 * are read with `governance:view` and written with `governance:manage`:
 * the create control and the per-row actions appear only for a viewer who
 * holds the write grant.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
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
 * pane. Every other parameter (the sort, say) is preserved.
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

function PeoplePage() {
  const { tab, selectTab } = usePeopleTab();

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <Heading size="md">People</Heading>

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
            <PeopleTabPane />
          </Tabs.Content>
          <Tabs.Content value="departments" paddingTop={4}>
            <DepartmentsTabPane />
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </GovernanceLayout>
  );
}

/*
 * People tab
 */

function PeopleTabPane() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  const canReadSources = hasAnyPermission("ingestionSources:view");
  const canManage = hasAnyPermission("governance:manage");
  const { sortBy, setSortBy } = useSpendSortParam();

  if (!canReadActivity) {
    return (
      <PermissionRequiredNotice
        permission="activityMonitor:view"
        detail="Spend and activity per person stay hidden until then."
      />
    );
  }

  return (
    <VStack align="stretch" gap={6} width="full">
      <PeopleSpendPanel
        orgId={orgId}
        sortBy={sortBy}
        onSortChange={setSortBy}
        canReadSources={canReadSources}
      />
      <DiscoveredPeoplePanel orgId={orgId} canManage={canManage} />
    </VStack>
  );
}

/*
 * Departments tab
 */

function DepartmentsTabPane() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const canManage = hasAnyPermission("governance:manage");

  const utils = api.useUtils();
  const listQuery = api.departments.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const refresh = async () => {
    await utils.departments.list.invalidate({ organizationId: orgId });
  };

  const departments = listQuery.data ?? [];

  // The departments the providers' directories name live beside the list an
  // administrator creates: the first is where the names come from, the
  // second is what spend rolls up by.
  const peopleQuery = api.governancePeople.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  return (
    <VStack align="stretch" gap={4} width="full">
      <HStack justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Text fontSize="sm" color="fg.muted">
          Spend rolls up by department, including personal AI use.
        </Text>
        {canManage && (
          <CreateDepartmentControl orgId={orgId} onCreated={refresh} />
        )}
      </HStack>

      <HandledErrorAlert
        error={listQuery.error}
        fallbackTitle="Couldn't load departments"
      />

      <ObservedDepartmentsPanel people={peopleQuery.data ?? []} />

      <DepartmentList
        orgId={orgId}
        departments={departments}
        isLoading={listQuery.isLoading}
        onChanged={refresh}
        canManage={canManage}
      />

      {!canManage && (
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
 * The proof column's words, for humans rather than for the enum — keyed off
 * the engine's own vocabulary so a kind added there fails the build here
 * instead of silently rendering its slug.
 */
const EVIDENCE_LABEL: Record<string, string> = {
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL]: "confirmed address",
  [MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID]:
    "confirmed address + directory",
  [MATCH_EVIDENCE_KIND.DIRECTORY_ID]: "directory identifier",
  [MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED]: "confirmed by a person",
} satisfies Record<
  (typeof MATCH_EVIDENCE_KIND)[keyof typeof MATCH_EVIDENCE_KIND],
  string
>;

const fmtDay = (d: Date | string) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
};

/**
 * Everyone the providers named, with the match engine's verdicts beside them
 * and its button in front of them. The engine keeps no standing appointment
 * of its own — this button is the trigger its spec left to the screen.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
function useDiscoveredPeople(orgId: string) {
  const utils = api.useUtils();
  const peopleQuery = api.governancePeople.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const suggestionsQuery = api.governancePeople.suggestions.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const refreshIdentity = async () => {
    await Promise.all([
      utils.governancePeople.list.invalidate({ organizationId: orgId }),
      utils.governancePeople.suggestions.invalidate({ organizationId: orgId }),
    ]);
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
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't run the match pass",
      }),
  });

  return { peopleQuery, suggestionsQuery, refreshIdentity, runMatch };
}

function DiscoveredPeopleHeader({
  canManage,
  running,
  onRun,
}: {
  canManage: boolean;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      backgroundColor="bg.subtle"
      justifyContent="space-between"
    >
      <VStack align="start" gap={0}>
        <Text
          fontSize="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          People the providers see
        </Text>
        <Text fontSize="xs" color="fg.subtle">
          Everyone named on pulled rows, most of whom hold no LangWatch account.
          Run the match pass to link the ones something proves.
        </Text>
      </VStack>
      {canManage && (
        <Button
          size="xs"
          colorPalette="orange"
          loading={running}
          onClick={onRun}
        >
          Run match pass
        </Button>
      )}
    </HStack>
  );
}

function DiscoveredPeoplePanel({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}) {
  const { peopleQuery, suggestionsQuery, refreshIdentity, runMatch } =
    useDiscoveredPeople(orgId);
  const people = peopleQuery.data ?? [];
  const suggestions = suggestionsQuery.data ?? [];

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
        <DiscoveredPeopleHeader
          canManage={canManage}
          running={runMatch.isPending}
          onRun={() => runMatch.mutate({ organizationId: orgId })}
        />

        <HandledErrorAlert
          error={peopleQuery.error}
          fallbackTitle="Couldn't load discovered people"
        />

        {peopleQuery.isLoading ? (
          <Box padding={4}>
            <Spinner />
          </Box>
        ) : people.length === 0 ? (
          <Box padding={4} color="fg.muted" fontSize="sm">
            Nobody discovered yet. People appear here as pull sources deliver
            rows that name them.
          </Box>
        ) : (
          people.map((person) => (
            <DiscoveredPersonRow key={person.id} person={person} />
          ))
        )}
      </VStack>

      {suggestions.length > 0 && (
        <SuggestionsPanel
          orgId={orgId}
          suggestions={suggestions}
          canManage={canManage}
          onChanged={refreshIdentity}
        />
      )}
    </>
  );
}

function DiscoveredPersonRow({ person }: { person: DiscoveredPerson }) {
  const isMachine = person.kind !== "person";
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      justifyContent="space-between"
      gap={4}
    >
      <VStack align="start" gap={0} minW={0}>
        <HStack gap={2}>
          <Text fontWeight="medium" truncate>
            {person.displayText}
          </Text>
          {person.erasedAt && <Badge colorPalette="purple">erased</Badge>}
          {isMachine && <Badge colorPalette="gray">machine login</Badge>}
          {person.suspendedAt && (
            <Badge colorPalette="yellow" title={person.suspendedReason ?? ""}>
              needs review
            </Badge>
          )}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {person.provider} · seen {fmtDay(person.firstSeenAt)} –{" "}
          {fmtDay(person.lastSeenAt)}
        </Text>
      </VStack>
      <PersonLinkCell person={person} />
    </HStack>
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
 * What it is for: an administrator opening this screen on a fresh tenant can
 * see the departments their directory already contains, and create the ones
 * they want to attribute spend by, instead of guessing at names.
 *
 * Hidden when the providers name none — an empty panel would suggest the
 * directory was read and came back blank, which is the same picture as a
 * directory that was never switched on.
 */
function ObservedDepartmentsPanel({ people }: { people: DiscoveredPerson[] }) {
  const observed = groupObservedDepartments(people);
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
          want to attribute spend by above — spend rolls up by your own
          departments, not by these.
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
 * The right-hand column: who the person is linked to, or that they are not,
 * and the department either half of the pair knows about.
 *
 * An unlinked person gets the department too, which is the whole point of
 * carrying it on the row: on a tenant where nobody is linked yet, the
 * directory is the only thing that knows where anybody works.
 */
function PersonLinkCell({ person }: { person: DiscoveredPerson }) {
  // Null for an erased person: erasure removes the stored department, and the
  // label helper refuses to describe one regardless.
  const department = departmentLabelFor(person);
  return (
    <VStack align="end" gap={0} flexShrink={0}>
      {person.link ? (
        <>
          <Text fontSize="sm">
            {person.link.memberName ?? person.link.userId}
            {department ? ` · ${department}` : ""}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            linked ·{" "}
            {EVIDENCE_LABEL[person.link.evidenceKind] ??
              person.link.evidenceKind}
          </Text>
        </>
      ) : (
        <>
          {department && <Text fontSize="sm">{department}</Text>}
          <Text fontSize="xs" color="fg.subtle">
            {person.erasedAt ? "" : "not linked"}
          </Text>
        </>
      )}
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

/** Mounted only for a viewer holding `governance:manage`. */
function CreateDepartmentControl({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: () => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const createMutation = api.departments.create.useMutation({
    onSuccess: async () => {
      setNewName("");
      toaster.create({ title: "Department created", type: "success" });
      await onCreated();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't create department" }),
  });

  const submit = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ organizationId: orgId, name: newName.trim() });
  };

  return (
    <HStack>
      <Input
        size="sm"
        width="16rem"
        aria-label="Create a department"
        placeholder="New department name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <Button
        size="sm"
        colorPalette="orange"
        loading={createMutation.isPending}
        disabled={!newName.trim()}
        onClick={submit}
      >
        Create
      </Button>
    </HStack>
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
              description="A person's spend, including personal AI use, rolls up to their department. Assign each member from the members page."
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
  departments: Department[];
  isLoading: boolean;
  onChanged: () => Promise<void>;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [archiving, setArchiving] = useState<Department | null>(null);

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
  department: Department;
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
