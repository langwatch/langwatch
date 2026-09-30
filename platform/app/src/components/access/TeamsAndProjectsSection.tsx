import {
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  Field,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { roleTone } from "~/components/access/roleAssignments";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { SectionTitle } from "~/components/settings/kit/SettingRow";
import { Dialog } from "~/components/ui/dialog";
import { Link } from "~/components/ui/link";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { DepartmentPicker } from "../../components/settings/DepartmentPicker";
import {
  type DepartmentOption,
  useDepartmentColumn,
} from "../../components/settings/useDepartmentColumn";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { RouterOutputs } from "../../utils/api";
import { api } from "../../utils/api";
import { isBindingRoleAllowedForOrganizationRole } from "../../utils/memberRoleConstraints";

import {
  type BindingRoleSelection,
  bindingRoleItems,
  bindingRoleSelectionValue,
  parseBindingRoleSelection,
} from "./role-selection";

type TeamData = RouterOutputs["team"]["getTeamsWithRoleBindings"][number];
type ProjectAccessEntry = TeamData["projectAccess"][string][number];

// ── Role options ──────────────────────────────────────────────────────────────

// A role's colour is decided once, in `roleAssignments`, by how much the
// role can do — a local copy here disagreed with it for custom roles.

/**
 * The tracked, quiet label every sub-section leads with — the same register
 * as the eyebrow on the role cards and the stat-tile labels on the directory
 * overview, so the three surfaces read as one system.
 */
function SectionEyebrow({
  children,
  mb,
}: {
  children: ReactNode;
  /** Room under the label where it leads a list rather than a header row. */
  mb?: number;
}) {
  return (
    <Text
      fontSize="10px"
      fontWeight="medium"
      color="fg.subtle"
      textTransform="uppercase"
      letterSpacing="0.08em"
      mb={mb}
    >
      {children}
    </Text>
  );
}

// ── Role select inline ────────────────────────────────────────────────────────

function RoleSelect({
  value,
  customRoleId,
  organizationId,
  onChange,
  size = "sm",
}: {
  value: string;
  customRoleId?: string | null;
  organizationId: string;
  onChange: (role: BindingRoleSelection["role"], customRoleId?: string) => void;
  size?: "sm" | "md";
}) {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const roleItems = bindingRoleItems(customRoles.data ?? []);
  const roleCollection = createListCollection({ items: roleItems });
  const selectValue = bindingRoleSelectionValue({ role: value, customRoleId });

  return (
    <Select.Root
      collection={roleCollection}
      value={[selectValue]}
      onValueChange={(e) => {
        const selected = parseBindingRoleSelection(e.value[0] ?? selectValue);
        if (selected) {
          onChange(selected.role, selected.customRoleId);
        }
      }}
      disabled={customRoles.isLoading}
      size={size}
      width="140px"
    >
      <Select.Trigger>
        <Select.ValueText />
      </Select.Trigger>
      <Select.Content paddingY={2}>
        {roleItems.map((item) => (
          <Select.Item key={item.value} item={item}>
            {item.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

// ── Add member to team modal ──────────────────────────────────────────────────

function AddToTeamDialog({
  teamId,
  teamName,
  organizationId,
  existingMemberIds,
  open,
  onClose,
}: {
  teamId: string;
  teamName: string;
  organizationId: string;
  existingMemberIds: string[];
  open: boolean;
  onClose: () => void;
}) {
  const {
    userId,
    setUserId,
    selection,
    selectValue,
    onRoleValueChange,
    create,
    userCollection,
    allRoleCollection,
  } = useAddToTeamForm({ organizationId, existingMemberIds, open, onClose });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg" maxWidth="440px">
        <Dialog.Header>
          <Dialog.Title>Add member to {teamName}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <Field.Root>
              <Field.Label>Person</Field.Label>
              <Select.Root
                collection={userCollection}
                value={userId ? [userId] : []}
                onValueChange={(e) => setUserId(e.value[0] ?? "")}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select person..." />
                </Select.Trigger>
                <Select.Content>
                  {userCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>Role on this team</Field.Label>
              <Select.Root
                collection={allRoleCollection}
                value={[selectValue]}
                onValueChange={onRoleValueChange}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {allRoleCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>

            <Text fontSize="sm" color="fg.muted">
              This gives them access to all projects in the team at this role
              level.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!userId}
            loading={create.isPending}
            onClick={() =>
              create.mutate({
                organizationId,
                userId,
                ...selection,
                scopeType: "TEAM",
                scopeId: teamId,
              })
            }
          >
            Add member
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ── Add person to project modal ───────────────────────────────────────────────

function AddToProjectDialog({
  projectId,
  projectName,
  organizationId,
  open,
  onClose,
}: {
  projectId: string;
  projectName: string;
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const {
    userId,
    setUserId,
    selection,
    selectValue,
    onRoleValueChange,
    create,
    userCollection,
    allRoleCollection,
  } = useAddToProjectForm({ organizationId, open, onClose });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg" maxWidth="440px">
        <Dialog.Header>
          <Dialog.Title>Add access to {projectName}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <Field.Root>
              <Field.Label>Person</Field.Label>
              <Select.Root
                collection={userCollection}
                value={userId ? [userId] : []}
                onValueChange={(e) => setUserId(e.value[0] ?? "")}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select person..." />
                </Select.Trigger>
                <Select.Content>
                  {userCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>Role on this project</Field.Label>
              <Select.Root
                collection={allRoleCollection}
                value={[selectValue]}
                onValueChange={onRoleValueChange}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {allRoleCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>

            <Text fontSize="sm" color="fg.muted">
              If they&apos;re already on the team, this overrides their team
              role for this project only.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!userId}
            loading={create.isPending}
            onClick={() =>
              create.mutate({
                organizationId,
                userId,
                ...selection,
                scopeType: "PROJECT",
                scopeId: projectId,
              })
            }
          >
            Add access
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ── Project row ───────────────────────────────────────────────────────────────

/**
 * Below this many siblings, a collapsed group hides everything and saves
 * nothing: the reader still scrolls the same distance and now has to click to
 * find out there was one row under it. Collapsing earns its place once a list
 * is long enough to scan, and not before.
 */
const EXPAND_BELOW = 3;

function ProjectSection({
  project,
  teamId,
  access,
  organizationId,
  canManage,
  department,
  defaultExpanded = false,
}: {
  project: { id: string; name: string };
  teamId: string;
  access: ProjectAccessEntry[];
  organizationId: string;
  canManage: boolean;
  department: ReturnType<typeof useDepartmentColumn>;
  /** Open on arrival, where there are too few projects for collapsing to help. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingPerson, setAddingPerson] = useState(false);
  const { openDrawer } = useDrawer();
  const queryClient = api.useUtils();

  const deleteBinding = api.roleBinding.delete.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't remove the access" }),
  });

  const inherited = access.filter((a) => a.source === "team");
  const projectLevel = access.filter((a) => a.source !== "team");
  const hasOverrides = projectLevel.length > 0;

  return (
    <>
      <Box borderWidth="1px" borderRadius="md" mb={2} overflow="hidden">
        <ProjectSectionHeader
          project={project}
          teamId={teamId}
          organizationId={organizationId}
          canManage={canManage}
          department={department}
          expanded={expanded}
          hasOverrides={hasOverrides}
          accessCount={access.length}
          onToggle={() => setExpanded((v) => !v)}
          openDrawer={openDrawer}
        />

        {expanded && (
          <Box px={3} pb={3} borderTopWidth="1px">
            {inherited.length > 0 && <InheritedFromTeam members={inherited} />}

            {hasOverrides && (
              <ProjectLevelAccess
                members={projectLevel}
                canManage={canManage}
                onRemove={(bindingId) =>
                  deleteBinding.mutate({ organizationId, bindingId })
                }
                removing={deleteBinding.isPending}
              />
            )}

            {/* Empty state */}
            {projectLevel.length === 0 && inherited.length > 0 && (
              <Text fontSize="xs" color="fg.subtle" fontStyle="italic" mt={2}>
                No project-level overrides. Everyone uses their team role.
              </Text>
            )}

            {/* Add actions */}
            {canManage && (
              <HStack mt={3} gap={2} flexWrap="wrap">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setAddingPerson(true)}
                >
                  <Plus size={12} />
                  Add person to this project
                </Button>
              </HStack>
            )}
          </Box>
        )}
      </Box>

      {addingPerson && (
        <AddToProjectDialog
          projectId={project.id}
          projectName={project.name}
          organizationId={organizationId}
          open={addingPerson}
          onClose={() => setAddingPerson(false)}
        />
      )}
    </>
  );
}

// ── Team card ─────────────────────────────────────────────────────────────────

// Inline department picker for team and project rows. Reads as one more meta
// item next to "N projects · M members": a leading dot, a normal-case
// "Department" caption, then a compact select.
function InlineDepartment({
  organizationId,
  kind,
  entityId,
  value,
  departments,
  onAssigned,
}: {
  organizationId: string;
  kind: "team" | "project";
  entityId: string;
  value: string | null;
  departments: DepartmentOption[];
  onAssigned: () => Promise<unknown> | void;
}) {
  return (
    <HStack
      gap={2}
      pl={2}
      color="fg.muted"
      fontSize="sm"
      onClick={(e) => e.stopPropagation()}
    >
      <Text>·</Text>
      <Text>Department</Text>
      <DepartmentPicker
        organizationId={organizationId}
        kind={kind}
        entityId={entityId}
        value={value}
        departments={departments}
        onAssigned={onAssigned}
        width="130px"
      />
    </HStack>
  );
}

function TeamCard({
  team,
  organizationId,
  canManage,
  defaultExpanded = false,
}: {
  team: TeamData;
  organizationId: string;
  canManage: boolean;
  /** Open on arrival, where there are too few teams for collapsing to help. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingMember, setAddingMember] = useState(false);
  const { openDrawer } = useDrawer();
  const { hasPermission } = useOrganizationTeamProject();
  const department = useDepartmentColumn(organizationId);

  const { deleteBinding, updateBinding } = useTeamBindingActions();

  const existingMemberIds = team.directMembers.flatMap((m) =>
    m.userId ? [m.userId] : [],
  );

  return (
    <>
      <Card.Root overflow="hidden">
        <TeamCardHeader
          team={team}
          organizationId={organizationId}
          canManage={canManage}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          department={department}
        />

        {expanded && (
          <Card.Body pt={0} borderTopWidth="1px">
            <TeamMembersBlock
              team={team}
              organizationId={organizationId}
              canManage={canManage}
              onAddMember={() => setAddingMember(true)}
              onChangeRole={(role, customRoleId, bindingId) =>
                updateBinding.mutate({
                  organizationId,
                  bindingId,
                  role,
                  customRoleId,
                })
              }
              onRemove={(bindingId) =>
                deleteBinding.mutate({ organizationId, bindingId })
              }
              removing={deleteBinding.isPending}
            />

            {team.projectOnlyAccess.length > 0 && (
              <ProjectOnlyAccess
                members={team.projectOnlyAccess}
                onEditInProject={() => setExpanded(true)}
              />
            )}

            <TeamProjectsBlock
              team={team}
              canManage={canManage}
              hasPermission={hasPermission}
              openDrawer={openDrawer}
              organizationId={organizationId}
              department={department}
            />
          </Card.Body>
        )}
      </Card.Root>

      {addingMember && (
        <AddToTeamDialog
          teamId={team.id}
          teamName={team.name}
          organizationId={organizationId}
          existingMemberIds={existingMemberIds}
          open={addingMember}
          onClose={() => setAddingMember(false)}
        />
      )}
    </>
  );
}

// ── The section ───────────────────────────────────────────────────────────────

/**
 * The teams, and the projects each one holds — a tab of the Directory rather
 * than a page of its own.
 *
 * It was a navigation entry beside Members, which asked a reader to know in
 * advance whether the thing they were looking for was a person or the
 * container a person sits in. Both answer "who is here", so both are the
 * Directory, and the tab bar is where the change of subject happens.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function TeamsAndProjectsSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const { openDrawer } = useDrawer();

  const teams = api.team.getTeamsWithRoleBindings.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );

  const canManage = hasPermission("team:manage");
  const teamCount = teams.data?.length ?? 0;

  return (
    <VStack gap={4} width="full" align="stretch">
      {/* The tab's own action, at the end of the tab's first heading row —
          the same place People, Groups and Provisioning put theirs. */}
      <SectionTitle
        title="Teams & projects"
        hint="People on a team inherit access to all its projects. Open a project to add overrides or direct access."
        right={
          <HStack gap={2}>
            {hasPermission("project:create") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDrawer("createProject")}
              >
                <Plus size={14} />
                Add project
              </Button>
            )}
            {canManage && (
              <Button
                size="sm"
                colorPalette="orange"
                onClick={() => openDrawer("createTeam")}
              >
                <Plus size={14} />
                New team
              </Button>
            )}
          </HStack>
        }
      />

      {teams.isLoading && <Spinner />}

      {teams.data?.length === 0 && <Text color="fg.muted">No teams yet.</Text>}

      <VStack gap={3} width="full" align="stretch">
        {teams.data?.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            organizationId={organizationId}
            canManage={canManage}
            // A single team collapsed behind a chevron hides the whole page to
            // save one row of scrolling.
            defaultExpanded={teamCount < EXPAND_BELOW}
          />
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * One person on a team, and the three shapes that row takes.
 *
 * Inherited through a group: the role is shown and the GROUP is the link,
 * because the place to change it is the group, not here. Held directly and
 * editable: the role picker and a way off the team. Held directly but not
 * editable by this reader: the role, stated and no more.
 */
function TeamMemberRow({
  member: m,
  organizationId,
  canManage,
  isLast,
  onChangeRole,
  onRemove,
  removing,
}: {
  member: TeamData["directMembers"][number];
  organizationId: string;
  canManage: boolean;
  isLast: boolean;
  onChangeRole: (
    role: BindingRoleSelection["role"],
    customRoleId: string | undefined,
    bindingId: string,
  ) => void;
  onRemove: (bindingId: string) => void;
  removing: boolean;
}) {
  return (
    <HStack
      py={2}
      borderBottomWidth={isLast ? "0" : "1px"}
      borderColor="border.muted"
      opacity={m.viaGroupId ? 0.7 : 1}
    >
      <RandomColorAvatar name={m.name} image={m.image} size="xs" />
      <Text fontSize="sm" flex={1}>
        {m.name}
      </Text>
      {m.viaGroupId ? (
        <>
          <Badge colorPalette={roleTone(m.role)} size="sm">
            {m.customRoleName ?? m.role}
          </Badge>
          <Link
            href="/settings/directory?tab=groups"
            fontSize="xs"
            colorPalette="purple"
            color="colorPalette.fg"
          >
            via {m.viaGroupName}
          </Link>
        </>
      ) : canManage && m.bindingId ? (
        <>
          <RoleSelect
            value={m.role}
            customRoleId={m.customRoleId}
            organizationId={organizationId}
            onChange={(role, customRoleId) =>
              onChangeRole(role, customRoleId, m.bindingId!)
            }
          />
          <Button
            size="xs"
            variant="ghost"
            color="fg.subtle"
            loading={removing}
            onClick={() => onRemove(m.bindingId!)}
          >
            <X size={14} />
          </Button>
        </>
      ) : (
        <Badge colorPalette={roleTone(m.role)} size="sm">
          {m.customRoleName ?? m.role}
        </Badge>
      )}
    </HStack>
  );
}

/**
 * The team's one-line summary, and the control that opens it.
 *
 * The whole strip toggles rather than only the chevron: a header that looks
 * like a row people click is one. The two controls that are NOT the toggle —
 * the department picker and Edit — stop the click themselves.
 */
function TeamCardHeader({
  team,
  organizationId,
  canManage,
  expanded,
  onToggle,
  department,
}: {
  team: TeamData;
  organizationId: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  department: ReturnType<typeof useDepartmentColumn>;
}) {
  return (
    <HStack
      px={4}
      py={3}
      cursor="pointer"
      onClick={onToggle}
      transition="background 0.15s ease"
      _hover={{ bg: "bg.muted" }}
    >
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      <Text fontWeight="semibold">{team.name}</Text>
      <Spacer />
      <Text fontSize="sm" color="fg.muted">
        {team.projects.length}{" "}
        {team.projects.length === 1 ? "project" : "projects"}
        {" · "}
        {team.directMembers.length}{" "}
        {team.directMembers.length === 1 ? "member" : "members"}
        {team.projectOnlyAccess.length > 0 &&
          ` · ${team.projectOnlyAccess.length} via projects`}
      </Text>
      {department.show && canManage && (
        <InlineDepartment
          organizationId={organizationId}
          kind="team"
          entityId={team.id}
          value={department.byTeam.get(team.id) ?? null}
          departments={department.departments}
          onAssigned={department.refetch}
        />
      )}
      {canManage && (
        <Link
          href={`/settings/teams/${team.slug}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Button size="xs" variant="ghost" color="fg.subtle">
            <Pencil size={13} />
            Edit
          </Button>
        </Link>
      )}
    </HStack>
  );
}

/**
 * The team's own members: the bindings held ON the team, and editable here.
 *
 * The note under the list is load-bearing — a role changed here is inherited
 * by every project below, which a list showing only the team does not say.
 */
function TeamMembersBlock({
  team,
  organizationId,
  canManage,
  onAddMember,
  onChangeRole,
  onRemove,
  removing,
}: {
  team: TeamData;
  organizationId: string;
  canManage: boolean;
  onAddMember: () => void;
  onChangeRole: (
    role: BindingRoleSelection["role"],
    customRoleId: string | undefined,
    bindingId: string,
  ) => void;
  onRemove: (bindingId: string) => void;
  removing: boolean;
}) {
  return (
    <Box mt={4}>
      <HStack mb={3}>
        <SectionEyebrow>Team members</SectionEyebrow>
        <Spacer />
        {canManage && (
          <Button
            size="xs"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onAddMember();
            }}
          >
            <Plus size={12} />
            Add to team
          </Button>
        )}
      </HStack>

      {team.directMembers.length === 0 ? (
        <Text fontSize="sm" color="fg.subtle" fontStyle="italic">
          No members yet.
        </Text>
      ) : (
        team.directMembers.map((m, i, arr) => (
          <TeamMemberRow
            key={i}
            member={m}
            organizationId={organizationId}
            canManage={canManage}
            isLast={i === arr.length - 1}
            onChangeRole={onChangeRole}
            onRemove={onRemove}
            removing={removing}
          />
        ))
      )}
      <Text fontSize="xs" color="fg.subtle" mt={2}>
        Editing a role here changes their team-level access, inherited by all
        projects below.
      </Text>
    </Box>
  );
}

/**
 * People who reach this team's work through a project rather than the team.
 *
 * Read-only here on purpose: the access was granted on a project, so the
 * project is where it can be changed. Showing it at team level anyway is the
 * honest version — an administrator counting who can see this team's work
 * needs these names and would otherwise miss them.
 */
function ProjectOnlyAccess({
  members,
  onEditInProject,
}: {
  members: TeamData["projectOnlyAccess"];
  onEditInProject: () => void;
}) {
  return (
    <Box mt={5}>
      <SectionEyebrow mb={3}>Also has access via projects</SectionEyebrow>
      {members.map((m, i) => (
        <HStack
          key={i}
          py={2}
          fontSize="sm"
          borderBottomWidth={i < members.length - 1 ? "1px" : "0"}
          borderColor="border.muted"
        >
          <RandomColorAvatar name={m.name} image={m.image} size="xs" />
          <Text flex={1}>{m.name}</Text>
          <Badge colorPalette={roleTone(m.role)} size="sm">
            {m.role}
          </Badge>
          <Text fontSize="xs" color="fg.subtle">
            on
          </Text>
          <Badge colorPalette="green" size="sm" gap={1}>
            <Folder size={14} />
            {m.projectName}
          </Badge>
          <Link
            fontSize="xs"
            colorPalette="purple"
            color="colorPalette.fg"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onEditInProject();
            }}
          >
            Edit in project →
          </Link>
        </HStack>
      ))}
    </Box>
  );
}

/** The projects this team owns, and the way into each one's access. */
function TeamProjectsBlock({
  team,
  canManage,
  hasPermission,
  openDrawer,
  organizationId,
  department,
}: {
  team: TeamData;
  canManage: boolean;
  hasPermission: ReturnType<typeof useOrganizationTeamProject>["hasPermission"];
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  organizationId: string;
  department: ReturnType<typeof useDepartmentColumn>;
}) {
  return (
    <Box mt={5}>
      <HStack mb={3}>
        <SectionEyebrow>Projects</SectionEyebrow>
        <Spacer />
        {hasPermission("project:create") && (
          <Button
            size="xs"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              openDrawer("createProject", {
                defaultTeamId: team.id,
              });
            }}
          >
            <Plus size={12} />
            Add project
          </Button>
        )}
      </HStack>
      {team.projects.length === 0 ? (
        <Text fontSize="sm" color="fg.subtle" fontStyle="italic">
          No projects yet.
        </Text>
      ) : (
        team.projects.map((proj) => (
          <ProjectSection
            key={proj.id}
            project={proj}
            teamId={team.id}
            access={team.projectAccess[proj.id] ?? []}
            organizationId={organizationId}
            canManage={canManage}
            department={department}
            defaultExpanded={team.projects.length < EXPAND_BELOW}
          />
        ))
      )}
    </Box>
  );
}

/**
 * Changing and removing a team binding, with the invalidation both need.
 *
 * Both refetch `getTeamsWithRoleBindings`, because that query draws the row
 * that just changed; leaving it stale shows a role the server no longer holds.
 */
function useTeamBindingActions() {
  const queryClient = api.useUtils();
  const deleteBinding = api.roleBinding.delete.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't remove the member" }),
  });

  const updateBinding = api.roleBinding.update.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) =>
      showErrorToast({
        error: e,
        fallbackTitle: "Couldn't update the member's role",
      }),
  });

  return { deleteBinding, updateBinding };
}

/** The project strip: its name, whether it overrides the team, and the toggle. */
function ProjectSectionHeader({
  project,
  teamId,
  organizationId,
  canManage,
  department,
  expanded,
  hasOverrides,
  accessCount,
  onToggle,
  openDrawer,
}: {
  project: { id: string; name: string };
  teamId: string;
  organizationId: string;
  canManage: boolean;
  department: ReturnType<typeof useDepartmentColumn>;
  expanded: boolean;
  hasOverrides: boolean;
  accessCount: number;
  onToggle: () => void;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}) {
  return (
    <HStack
      px={3}
      py={2}
      cursor="pointer"
      onClick={onToggle}
      transition="background 0.15s ease"
      _hover={{ bg: "bg.muted" }}
    >
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <HStack gap={1.5} color="fg.subtle">
        <Folder size={14} />
        <Text fontSize="sm" fontWeight="medium" color="fg">
          {project.name}
        </Text>
      </HStack>
      {hasOverrides && (
        <Badge colorPalette="orange" size="sm">
          has overrides
        </Badge>
      )}
      <Spacer />
      <Text fontSize="xs" color="fg.muted">
        {accessCount} with access
      </Text>
      {canManage && (
        <Button
          size="xs"
          variant="ghost"
          color="fg.subtle"
          onClick={(e) => {
            e.stopPropagation();
            openDrawer("editProject", {
              projectId: project.id,
              projectName: project.name,
              currentTeamId: teamId,
            });
          }}
        >
          <Pencil size={13} />
          Edit
        </Button>
      )}
      {department.show && canManage && (
        <InlineDepartment
          organizationId={organizationId}
          kind="project"
          entityId={project.id}
          value={department.byProject.get(project.id) ?? null}
          departments={department.departments}
          onAssigned={department.refetch}
        />
      )}
    </HStack>
  );
}

/**
 * Access this project gets from the team, shown dimmed and not editable here.
 *
 * The role badge is NEUTRAL rather than the tier's tone: a red ADMIN pill is
 * the danger dialect answering a question nobody asked. This row only says
 * what the team role is, and the dimming already carries "inherited".
 */
function InheritedFromTeam({ members }: { members: ProjectAccessEntry[] }) {
  return (
    <Box mt={3}>
      <SectionEyebrow mb={2}>Inherited from team</SectionEyebrow>
      {members.map((m, i) => (
        <HStack key={i} py={1} opacity={0.5} fontSize="sm">
          <RandomColorAvatar name={m.name} image={m.image} size="xs" />
          <Text flex={1}>{m.name}</Text>
          {/* Neutral, not the tier's tone: a red ADMIN pill is the
            danger dialect answering a question nobody asked — this
            row only says what the team role IS, and the dimming
            already carries "inherited". Explicit project-level
            grants below keep `roleTone`. */}
          <Badge colorPalette="gray" size="sm">
            {m.customRoleName ?? m.role}
          </Badge>
          {m.viaGroupName ? (
            <Link
              href="/settings/directory?tab=groups"
              fontSize="xs"
              colorPalette="purple"
              color="colorPalette.fg"
            >
              via {m.viaGroupName}
            </Link>
          ) : (
            <Text fontSize="xs" color="fg.subtle">
              from team
            </Text>
          )}
        </HStack>
      ))}
    </Box>
  );
}

/**
 * Grants made ON the project, which override or add to what the team gives.
 *
 * These keep `roleTone` — unlike the inherited rows above — because an
 * explicit project-level ADMIN is a decision somebody made here, and the tone
 * is the fastest way to see it.
 */
function ProjectLevelAccess({
  members,
  canManage,
  onRemove,
  removing,
}: {
  members: ProjectAccessEntry[];
  canManage: boolean;
  onRemove: (bindingId: string) => void;
  removing: boolean;
}) {
  return (
    <Box mt={3}>
      <SectionEyebrow mb={2}>Project-level access</SectionEyebrow>
      {members.map((m, i) => (
        <HStack key={i} py={1} fontSize="sm">
          <RandomColorAvatar name={m.name} image={m.image} size="xs" />
          <Box flex={1}>
            <Text display="inline">{m.name}</Text>
            {m.source === "override" && m.teamRole && (
              <Text as="span" fontSize="xs" color="fg.subtle" ml={2}>
                team role: {m.teamRole}
              </Text>
            )}
          </Box>
          {m.source === "override" && (
            <Badge colorPalette="orange" size="sm">
              override
            </Badge>
          )}
          <Badge colorPalette={roleTone(m.role)} size="sm">
            {m.role}
          </Badge>
          {canManage && m.bindingId && (
            <Button
              size="xs"
              variant="ghost"
              color={m.source === "override" ? "orange.fg" : "fg.subtle"}
              title={
                m.source === "override"
                  ? "Remove override, revert to team role"
                  : "Remove project access"
              }
              loading={removing}
              onClick={() => onRemove(m.bindingId!)}
            >
              {m.source === "override" ? (
                <HStack gap={1}>
                  <RotateCcw size={12} />
                  <Text>revert</Text>
                </HStack>
              ) : (
                <X size={14} />
              )}
            </Button>
          )}
        </HStack>
      ))}
    </Box>
  );
}

/**
 * The state behind "add somebody to this team".
 *
 * The role list is narrowed by the person chosen, not merely validated after:
 * an EXTERNAL member cannot hold most team roles, so offering them and
 * refusing on submit would be asking a question we already know the answer to.
 * The effect below is the same rule applied to a choice already made when the
 * person changes underneath it.
 */
function useAddToTeamForm({
  organizationId,
  existingMemberIds,
  open,
  onClose,
}: {
  organizationId: string;
  existingMemberIds: string[];
  open: boolean;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const { selection, setSelection, selectValue, onRoleValueChange } =
    useBindingRoleSelection("MEMBER");
  const queryClient = api.useUtils();

  const orgMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: false },
      { enabled: open },
    );

  const create = api.roleBinding.create.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Member added", type: "success" });
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
      onClose();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't add the member" }),
  });

  const userItems = useMemo(
    () =>
      (orgMembers.data?.members ?? [])
        .filter((m) => !existingMemberIds.includes(m.userId))
        .map((m) => ({
          label: `${m.user.name ?? m.user.email} (${m.user.email})`,
          value: m.userId,
        })),
    [orgMembers.data, existingMemberIds],
  );
  const userCollection = useMemo(
    () => createListCollection({ items: userItems }),
    [userItems],
  );

  const selectedMemberRole = useMemo(
    () =>
      (orgMembers.data?.members ?? []).find((m) => m.userId === userId)?.role,
    [orgMembers.data, userId],
  );

  const allRoleCollection = useTeamRoleOptions({
    organizationId,
    open,
    selectedMemberRole,
  });

  useEffect(() => {
    if (selectedMemberRole !== OrganizationUserRole.EXTERNAL) return;
    if (selection.role !== "VIEWER") {
      setSelection({ role: "VIEWER", customRoleId: void 0 });
    }
  }, [selectedMemberRole, selection.role, setSelection]);

  return {
    userId,
    setUserId,
    selection,
    selectValue,
    onRoleValueChange,
    create,
    userCollection,
    allRoleCollection,
    selectedMemberRole,
  };
}

/**
 * The team roles a chosen person may actually be given.
 *
 * Narrowed by the person's ORGANIZATION role rather than merely validated on
 * submit: an EXTERNAL member can hold only the viewer grain, and offering the
 * rest asks a question whose answer we already hold.
 */
function useTeamRoleOptions({
  organizationId,
  open,
  selectedMemberRole,
}: {
  organizationId: string;
  open: boolean;
  selectedMemberRole: OrganizationUserRole | undefined;
}) {
  const customRoles = api.role.getAll.useQuery(
    { organizationId },
    { enabled: open },
  );
  const allRoleItems = useMemo(() => {
    const items = bindingRoleItems(customRoles.data ?? []);
    if (!selectedMemberRole) return items;
    return items.filter((item) => {
      const selection = parseBindingRoleSelection(item.value);
      if (!selection) return false;

      return isBindingRoleAllowedForOrganizationRole({
        organizationRole: selectedMemberRole,
        role:
          selection.role === "CUSTOM"
            ? `custom:${selection.customRoleId}`
            : selection.role,
      });
    });
  }, [customRoles.data, selectedMemberRole]);
  const allRoleCollection = useMemo(
    () => createListCollection({ items: allRoleItems }),
    [allRoleItems],
  );

  return allRoleCollection;
}

/**
 * The state behind "add access to this project".
 *
 * Unlike the team form, the role list is NOT narrowed by the person's
 * organization role: a project grant is the place an external collaborator is
 * given something specific, which is the case that form exists for.
 */
function useAddToProjectForm({
  organizationId,
  open,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const { selection, selectValue, onRoleValueChange } =
    useBindingRoleSelection("VIEWER");
  const queryClient = api.useUtils();

  const orgMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: false },
      { enabled: open },
    );
  const customRoles = api.role.getAll.useQuery(
    { organizationId },
    { enabled: open },
  );

  const create = api.roleBinding.create.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Access added", type: "success" });
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
      onClose();
    },
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't add the access" }),
  });

  const userItems = (orgMembers.data?.members ?? []).map((m) => ({
    label: `${m.user.name ?? m.user.email} (${m.user.email})`,
    value: m.userId,
  }));
  const userCollection = createListCollection({ items: userItems });

  const allRoleItems = bindingRoleItems(customRoles.data ?? []);
  const allRoleCollection = createListCollection({ items: allRoleItems });

  return {
    userId,
    setUserId,
    selection,
    selectValue,
    onRoleValueChange,
    create,
    userCollection,
    allRoleCollection,
  };
}

function useBindingRoleSelection(initialRole: "MEMBER" | "VIEWER") {
  const [selection, setSelection] = useState<BindingRoleSelection>({
    role: initialRole,
    customRoleId: void 0,
  });
  const onRoleValueChange = ({ value }: { value: string[] }) => {
    const selected = parseBindingRoleSelection(value[0] ?? initialRole);
    if (selected) setSelection(selected);
  };

  return {
    selection,
    setSelection,
    selectValue: bindingRoleSelectionValue(selection),
    onRoleValueChange,
  };
}
