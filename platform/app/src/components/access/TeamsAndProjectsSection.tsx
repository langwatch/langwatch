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
import {
  isBindingRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "../../utils/memberRoleConstraints";

type TeamData = RouterOutputs["team"]["getTeamsWithRoleBindings"][number];
type ProjectAccessEntry = TeamData["projectAccess"][string][number];

// ── Role options ──────────────────────────────────────────────────────────────

const BASE_ROLE_ITEMS = [
  { label: "Admin", value: "ADMIN" },
  { label: "Member", value: "MEMBER" },
  { label: "Viewer", value: "VIEWER" },
];

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
  onChange: (role: string, customRoleId?: string) => void;
  size?: "sm" | "md";
}) {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const roleItems = [
    ...BASE_ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({
      label: r.name,
      value: `CUSTOM:${r.id}`,
    })),
  ];
  const roleCollection = createListCollection({ items: roleItems });

  const selectValue =
    value === "CUSTOM" && customRoleId ? `CUSTOM:${customRoleId}` : value;

  return (
    <Select.Root
      collection={roleCollection}
      value={[selectValue]}
      onValueChange={(e) => {
        const v = e.value[0] ?? value;
        if (v.startsWith("CUSTOM:")) {
          onChange("CUSTOM", v.slice(7));
        } else {
          onChange(v, undefined);
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
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    undefined,
  );
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

  const allRoleItems = useMemo(() => {
    const items = [
      ...BASE_ROLE_ITEMS,
      ...(customRoles.data ?? []).map((r) => ({
        label: r.name,
        value: `CUSTOM:${r.id}`,
      })),
    ];
    if (!selectedMemberRole) return items;
    return items.filter((item) =>
      isBindingRoleAllowedForOrganizationRole({
        organizationRole: selectedMemberRole,
        role: (item.value.startsWith("CUSTOM:")
          ? `custom:${item.value.slice(7)}`
          : item.value) as TeamRoleValue,
      }),
    );
  }, [customRoles.data, selectedMemberRole]);
  const allRoleCollection = useMemo(
    () => createListCollection({ items: allRoleItems }),
    [allRoleItems],
  );

  useEffect(() => {
    if (selectedMemberRole !== OrganizationUserRole.EXTERNAL) return;
    if (role !== "VIEWER" || customRoleId) {
      setRole("VIEWER");
      setCustomRoleId(undefined);
    }
  }, [selectedMemberRole, role, customRoleId]);

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
                  {userItems.map((item) => (
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
                value={[customRoleId ? `CUSTOM:${customRoleId}` : role]}
                onValueChange={(e) => {
                  const v = e.value[0] ?? "MEMBER";
                  if (v.startsWith("CUSTOM:")) {
                    setRole("CUSTOM");
                    setCustomRoleId(v.slice(7));
                  } else {
                    setRole(v);
                    setCustomRoleId(undefined);
                  }
                }}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {allRoleItems.map((item) => (
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
                role: (customRoleId ? "CUSTOM" : role) as any,
                customRoleId,
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
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(
    undefined,
  );
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

  const allRoleItems = [
    ...BASE_ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({
      label: r.name,
      value: `CUSTOM:${r.id}`,
    })),
  ];
  const allRoleCollection = createListCollection({ items: allRoleItems });

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
                  {userItems.map((item) => (
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
                value={[customRoleId ? `CUSTOM:${customRoleId}` : role]}
                onValueChange={(e) => {
                  const v = e.value[0] ?? "VIEWER";
                  if (v.startsWith("CUSTOM:")) {
                    setRole("CUSTOM");
                    setCustomRoleId(v.slice(7));
                  } else {
                    setRole(v);
                    setCustomRoleId(undefined);
                  }
                }}
                size="md"
              >
                <Select.Trigger>
                  <Select.ValueText />
                </Select.Trigger>
                <Select.Content>
                  {allRoleItems.map((item) => (
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
                role: (customRoleId ? "CUSTOM" : role) as any,
                customRoleId,
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
        <HStack
          px={3}
          py={2}
          cursor="pointer"
          onClick={() => setExpanded((v) => !v)}
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
            {access.length} with access
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

        {expanded && (
          <Box px={3} pb={3} borderTopWidth="1px">
            {/* Inherited from team */}
            {inherited.length > 0 && (
              <Box mt={3}>
                <SectionEyebrow mb={2}>Inherited from team</SectionEyebrow>
                {inherited.map((m, i) => (
                  <HStack key={i} py={1} opacity={0.5} fontSize="sm">
                    <RandomColorAvatar
                      name={m.name}
                      image={m.image}
                      size="xs"
                    />
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
            )}

            {/* Project-level access */}
            {projectLevel.length > 0 && (
              <Box mt={3}>
                <SectionEyebrow mb={2}>Project-level access</SectionEyebrow>
                {projectLevel.map((m, i) => (
                  <HStack key={i} py={1} fontSize="sm">
                    <RandomColorAvatar
                      name={m.name}
                      image={m.image}
                      size="xs"
                    />
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
                        color={
                          m.source === "override" ? "orange.fg" : "fg.subtle"
                        }
                        title={
                          m.source === "override"
                            ? "Remove override, revert to team role"
                            : "Remove project access"
                        }
                        loading={deleteBinding.isPending}
                        onClick={() =>
                          deleteBinding.mutate({
                            organizationId,
                            bindingId: m.bindingId!,
                          })
                        }
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
  const queryClient = api.useUtils();
  const department = useDepartmentColumn(organizationId);

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

  const existingMemberIds = team.directMembers.flatMap((m) =>
    m.userId ? [m.userId] : [],
  );

  return (
    <>
      <Card.Root overflow="hidden">
        {/* Team header */}
        <HStack
          px={4}
          py={3}
          cursor="pointer"
          onClick={() => setExpanded((v) => !v)}
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

        {expanded && (
          <Card.Body pt={0} borderTopWidth="1px">
            {/* ── Team members (team-scoped bindings, editable) ── */}
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
                      setAddingMember(true);
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
                  <HStack
                    key={i}
                    py={2}
                    borderBottomWidth={i < arr.length - 1 ? "1px" : "0"}
                    borderColor="border.muted"
                    opacity={m.viaGroupId ? 0.7 : 1}
                  >
                    <RandomColorAvatar
                      name={m.name}
                      image={m.image}
                      size="xs"
                    />
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
                            updateBinding.mutate({
                              organizationId,
                              bindingId: m.bindingId!,
                              role: role as any,
                              customRoleId,
                            })
                          }
                        />
                        <Button
                          size="xs"
                          variant="ghost"
                          color="fg.subtle"
                          loading={deleteBinding.isPending}
                          onClick={() =>
                            deleteBinding.mutate({
                              organizationId,
                              bindingId: m.bindingId!,
                            })
                          }
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
                ))
              )}
              <Text fontSize="xs" color="fg.subtle" mt={2}>
                Editing a role here changes their team-level access, inherited
                by all projects below.
              </Text>
            </Box>

            {/* ── Project-only access (read-only at team level) ── */}
            {team.projectOnlyAccess.length > 0 && (
              <Box mt={5}>
                <SectionEyebrow mb={3}>
                  Also has access via projects
                </SectionEyebrow>
                {team.projectOnlyAccess.map((m, i) => (
                  <HStack
                    key={i}
                    py={2}
                    fontSize="sm"
                    borderBottomWidth={
                      i < team.projectOnlyAccess.length - 1 ? "1px" : "0"
                    }
                    borderColor="border.muted"
                  >
                    <RandomColorAvatar
                      name={m.name}
                      image={m.image}
                      size="xs"
                    />
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
                        setExpanded(true);
                      }}
                    >
                      Edit in project →
                    </Link>
                  </HStack>
                ))}
              </Box>
            )}

            {/* ── Projects ── */}
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
