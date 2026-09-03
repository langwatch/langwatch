import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Archive, ExternalLink, MoreVertical, Pencil } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { PermissionRequiredNotice } from "~/components/PermissionRequiredNotice";
import { DepartmentEditDrawer } from "~/components/settings/DepartmentEditDrawer";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type Department = RouterOutputs["departments"]["list"][number];
type DiscoveredPerson = RouterOutputs["governancePeople"]["list"][number];
type MatchSuggestion = RouterOutputs["governancePeople"]["suggestions"][number];

/**
 * The People page (nee Departments — the page identity renamed, the
 * department entity did not). Departments are read with `governance:view`
 * and written with `governance:manage`. The page opens on the read grant,
 * and the create box plus the per-row actions appear only for a viewer
 * who holds the write one.
 *
 * Spec: specs/ai-governance/rbac/delegated-governance-viewer.feature
 */
function PeoplePage() {
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
  const hasDepartments = departments.length > 0;

  return (
    <GovernanceLayout pageTitle="People · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <Heading size="md">People</Heading>

        <HandledErrorAlert
          error={listQuery.error}
          fallbackTitle="Couldn't load departments"
        />

        <DiscoveredPeoplePanel orgId={orgId} canManage={canManage} />

        {canManage && <CreateDepartmentBox orgId={orgId} onCreated={refresh} />}

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

        {hasDepartments && <AssignmentGuide />}
      </VStack>
    </GovernanceLayout>
  );
}

/** The proof column's words, for humans rather than for the enum. */
const EVIDENCE_LABEL: Record<string, string> = {
  verified_email: "confirmed address",
  verified_email_and_directory_id: "confirmed address + directory",
  human_confirmed: "confirmed by a person",
};

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
function DiscoveredPeoplePanel({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}) {
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
        description: `${outcome.linked} linked, ${outcome.suggestionsWritten} suggested, ${outcome.unproven} unproven.`,
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
              Everyone named on pulled rows, most of whom hold no LangWatch
              account. Run the match pass to link the ones something proves.
            </Text>
          </VStack>
          {canManage && (
            <Button
              size="xs"
              colorPalette="orange"
              loading={runMatch.isPending}
              onClick={() => runMatch.mutate({ organizationId: orgId })}
            >
              Run match pass
            </Button>
          )}
        </HStack>

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
      <VStack align="end" gap={0} flexShrink={0}>
        {person.link ? (
          <>
            <Text fontSize="sm">
              {person.link.memberName ?? person.link.userId}
              {person.link.departmentName
                ? ` · ${person.link.departmentName}`
                : ""}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              linked ·{" "}
              {EVIDENCE_LABEL[person.link.evidenceKind] ??
                person.link.evidenceKind}
            </Text>
          </>
        ) : (
          <Text fontSize="xs" color="fg.subtle">
            {person.erasedAt ? "" : "not linked"}
          </Text>
        )}
      </VStack>
    </HStack>
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
function CreateDepartmentBox({
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
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
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
    </Box>
  );
}

function AssignmentGuide() {
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
          Assigning departments
        </Text>
        <Text fontSize="xs" color="fg.subtle" marginTop={1}>
          Assign people and teams to a department where you already manage them.
          Spend rolls up by department, including personal AI use.
        </Text>
      </Box>
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
        borderBottomWidth="1px"
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
        <Box
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
        >
          Departments
        </Box>
        {isLoading ? (
          <Box padding={4}>
            <Spinner />
          </Box>
        ) : departments.length === 0 ? (
          <Box padding={4} color="fg.muted" fontSize="sm">
            No departments yet. Create one above to start attributing spend.
          </Box>
        ) : (
          departments.map((dept) => (
            <DepartmentRow
              key={dept.id}
              department={dept}
              onEdit={() => setEditing(dept)}
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
  onEdit,
  onArchive,
  canManage,
}: {
  department: Department;
  onEdit: () => void;
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
            <Button variant="ghost" size="xs" aria-label="Actions">
              <MoreVertical size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="edit" onClick={onEdit}>
              <Pencil size={14} /> Edit
            </Menu.Item>
            <Menu.Item value="archive" onClick={onArchive}>
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
