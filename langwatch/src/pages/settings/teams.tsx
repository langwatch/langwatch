import {
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  Field,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { ChevronDown, ChevronRight, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import SettingsLayout from "../../components/SettingsLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { RouterOutputs } from "../../utils/api";

type TeamData = RouterOutputs["team"]["getTeamsWithRoleBindings"][number];
type DirectMember = TeamData["directMembers"][number];
type ProjectAccessEntry = TeamData["projectAccess"][string][number];

// ── Role options ──────────────────────────────────────────────────────────────

const ROLE_ITEMS = [
  { label: "Admin", value: "ADMIN" },
  { label: "Member", value: "MEMBER" },
  { label: "Viewer", value: "VIEWER" },
];
const roleCollection = createListCollection({ items: ROLE_ITEMS });

function roleBadgeColor(role: string) {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  return "gray";
}

// ── Role select inline ────────────────────────────────────────────────────────

function RoleSelect({
  value,
  onChange,
  size = "sm",
}: {
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <Select.Root
      collection={roleCollection}
      value={[value]}
      onValueChange={(e) => onChange(e.value[0] ?? value)}
      size={size}
      width="120px"
    >
      <Select.Trigger>
        <Select.ValueText />
      </Select.Trigger>
      <Select.Content>
        {ROLE_ITEMS.map((item) => (
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
  open,
  onClose,
}: {
  teamId: string;
  teamName: string;
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(undefined);
  const queryClient = api.useContext();

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: false },
    { enabled: open },
  );
  const customRoles = api.role.getAll.useQuery({ organizationId }, { enabled: open });

  const create = api.roleBinding.create.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Member added", type: "success" });
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
      onClose();
    },
    onError: (e) => {
      toaster.create({ title: e.message, type: "error" });
    },
  });

  const userItems = (orgMembers.data?.members ?? []).map((m) => ({
    label: `${m.user.name ?? m.user.email} (${m.user.email})`,
    value: m.userId,
  }));
  const userCollection = createListCollection({ items: userItems });

  const allRoleItems = [
    ...ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({ label: r.name, value: `CUSTOM:${r.id}` })),
  ];
  const allRoleCollection = createListCollection({ items: allRoleItems });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content maxWidth="440px">
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

            <Text fontSize="sm" color="gray.500">
              This gives them access to all projects in the team at this role level.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
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
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(undefined);
  const queryClient = api.useContext();

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: false },
    { enabled: open },
  );
  const customRoles = api.role.getAll.useQuery({ organizationId }, { enabled: open });

  const create = api.roleBinding.create.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Access added", type: "success" });
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
      onClose();
    },
    onError: (e) => {
      toaster.create({ title: e.message, type: "error" });
    },
  });

  const userItems = (orgMembers.data?.members ?? []).map((m) => ({
    label: `${m.user.name ?? m.user.email} (${m.user.email})`,
    value: m.userId,
  }));
  const userCollection = createListCollection({ items: userItems });

  const allRoleItems = [
    ...ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({ label: r.name, value: `CUSTOM:${r.id}` })),
  ];
  const allRoleCollection = createListCollection({ items: allRoleItems });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content maxWidth="440px">
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

            <Text fontSize="sm" color="gray.500">
              If they&apos;re already on the team, this overrides their team role for this project only.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
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

function ProjectSection({
  project,
  access,
  organizationId,
  canManage,
}: {
  project: { id: string; name: string };
  access: ProjectAccessEntry[];
  organizationId: string;
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const queryClient = api.useContext();

  const deleteBinding = api.roleBinding.delete.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const inherited = access.filter((a) => a.source === "team");
  const projectLevel = access.filter((a) => a.source !== "team");
  const hasOverrides = projectLevel.length > 0;

  return (
    <>
      <Box
        borderWidth="1px"
        borderRadius="md"
        mb={2}
        overflow="hidden"
      >
        <HStack
          px={3}
          py={2}
          cursor="pointer"
          onClick={() => setExpanded((v) => !v)}
          _hover={{ bg: "gray.50", _dark: { bg: "gray.800" } }}
        >
          {expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          <Text fontSize="sm" fontWeight="medium">
            📁 {project.name}
          </Text>
          {hasOverrides && (
            <Badge colorPalette="orange" size="sm">
              has overrides
            </Badge>
          )}
          <Spacer />
          <Text fontSize="xs" color="gray.500">
            {access.length} with access
          </Text>
        </HStack>

        {expanded && (
          <Box
            px={3}
            pb={3}
            borderTopWidth="1px"
          >
            {/* Inherited from team */}
            {inherited.length > 0 && (
              <Box mt={3}>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  mb={2}
                >
                  Inherited from team
                </Text>
                {inherited.map((m, i) => (
                  <HStack
                    key={i}
                    py={1}
                    opacity={0.5}
                    fontSize="sm"
                  >
                    <RandomColorAvatar
                      name={m.name}
                      size="xs"
                    />
                    <Text flex={1}>{m.name}</Text>
                    <Badge colorPalette={roleBadgeColor(m.role)} size="sm">
                      {m.role}
                    </Badge>
                    <Text fontSize="xs" color="gray.400">
                      from team
                    </Text>
                  </HStack>
                ))}
              </Box>
            )}

            {/* Project-level access */}
            {projectLevel.length > 0 && (
              <Box mt={3}>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  mb={2}
                >
                  Project-level access
                </Text>
                {projectLevel.map((m, i) => (
                  <HStack key={i} py={1} fontSize="sm">
                    <RandomColorAvatar name={m.name} size="xs" />
                    <Box flex={1}>
                      <Text display="inline">{m.name}</Text>
                      {m.source === "override" && m.teamRole && (
                        <Text
                          as="span"
                          fontSize="xs"
                          color="gray.400"
                          ml={2}
                        >
                          team role: {m.teamRole}
                        </Text>
                      )}
                    </Box>
                    {m.source === "override" && (
                      <Badge colorPalette="orange" size="sm">
                        override
                      </Badge>
                    )}
                    <Badge colorPalette={roleBadgeColor(m.role)} size="sm">
                      {m.role}
                    </Badge>
                    {canManage && m.bindingId && (
                      <Button
                        size="xs"
                        variant="ghost"
                        color={m.source === "override" ? "orange.400" : "gray.400"}
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
              <Text
                fontSize="xs"
                color="gray.400"
                fontStyle="italic"
                mt={2}
              >
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

function TeamCard({
  team,
  organizationId,
  canManage,
}: {
  team: TeamData;
  organizationId: string;
  canManage: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const { openDrawer } = useDrawer();
  const { hasPermission } = useOrganizationTeamProject();
  const queryClient = api.useContext();

  const deleteBinding = api.roleBinding.delete.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const updateBinding = api.roleBinding.update.useMutation({
    onSuccess: () => {
      void queryClient.team.getTeamsWithRoleBindings.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  return (
    <>
      <Card.Root overflow="hidden">
        {/* Team header */}
        <HStack
          px={4}
          py={3}
          cursor="pointer"
          onClick={() => setExpanded((v) => !v)}
          _hover={{ bg: "gray.50", _dark: { bg: "gray.800" } }}
        >
          {expanded ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
          <Text fontWeight="semibold">{team.name}</Text>
          <Spacer />
          <Text fontSize="sm" color="gray.500">
            {team.projects.length}{" "}
            {team.projects.length === 1 ? "project" : "projects"}
            {" · "}
            {team.directMembers.length}{" "}
            {team.directMembers.length === 1 ? "member" : "members"}
            {team.projectOnlyAccess.length > 0 &&
              ` · ${team.projectOnlyAccess.length} via projects`}
          </Text>
          {canManage && (
            <Link
              href={`/settings/teams/${team.slug}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Button size="xs" variant="ghost" color="gray.400">
                <Pencil size={13} />
                Edit
              </Button>
            </Link>
          )}
        </HStack>

        {expanded && (
          <Card.Body
            pt={0}
            borderTopWidth="1px"
          >
            {/* ── Team members (team-scoped bindings, editable) ── */}
            <Box mt={4}>
              <HStack mb={3}>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                >
                  Team members
                </Text>
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
                <Text fontSize="sm" color="gray.400" fontStyle="italic">
                  No members yet.
                </Text>
              ) : (
                team.directMembers.map((m, i) => (
                  <HStack
                    key={i}
                    py={2}
                    borderBottomWidth={
                      i < team.directMembers.length - 1 ? "1px" : "0"
                    }
                    borderColor="gray.100"
                    _dark={{ borderColor: "gray.700" }}
                  >
                    <RandomColorAvatar name={m.name} size="xs" />
                    <Text fontSize="sm" flex={1}>
                      {m.name}
                    </Text>
                    {canManage && m.bindingId && !m.fromFallback ? (
                      <RoleSelect
                        value={m.role}
                        onChange={(role) =>
                          updateBinding.mutate({
                            organizationId,
                            bindingId: m.bindingId!,
                            role: role as any,
                          })
                        }
                      />
                    ) : (
                      <Badge colorPalette={roleBadgeColor(m.role)} size="sm">
                        {m.role}
                      </Badge>
                    )}
                    {canManage && m.bindingId && !m.fromFallback && (
                      <Button
                        size="xs"
                        variant="ghost"
                        color="gray.400"
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
                    )}
                  </HStack>
                ))
              )}
              <Text fontSize="xs" color="gray.400" mt={2}>
                Editing a role here changes their team-level access, inherited
                by all projects below.
              </Text>
            </Box>

            {/* ── Project-only access (read-only at team level) ── */}
            {team.projectOnlyAccess.length > 0 && (
              <Box mt={5}>
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                  mb={3}
                >
                  Also has access via projects
                </Text>
                {team.projectOnlyAccess.map((m, i) => (
                  <HStack
                    key={i}
                    py={2}
                    fontSize="sm"
                    borderBottomWidth={
                      i < team.projectOnlyAccess.length - 1 ? "1px" : "0"
                    }
                    borderColor="gray.100"
                    _dark={{ borderColor: "gray.700" }}
                  >
                    <RandomColorAvatar name={m.name} size="xs" />
                    <Text flex={1}>{m.name}</Text>
                    <Badge colorPalette={roleBadgeColor(m.role)} size="sm">
                      {m.role}
                    </Badge>
                    <Text fontSize="xs" color="gray.400">
                      on
                    </Text>
                    <Badge colorPalette="green" size="sm">
                      📁 {m.projectName}
                    </Badge>
                    <Link
                      fontSize="xs"
                      color="purple.400"
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
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.500"
                  textTransform="uppercase"
                  letterSpacing="wider"
                >
                  Projects
                </Text>
                <Spacer />
                {hasPermission("project:create") && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDrawer("createProject");
                    }}
                  >
                    <Plus size={12} />
                    Add project
                  </Button>
                )}
              </HStack>
              {team.projects.length === 0 ? (
                <Text fontSize="sm" color="gray.400" fontStyle="italic">
                  No projects yet.
                </Text>
              ) : (
                team.projects.map((proj) => (
                  <ProjectSection
                    key={proj.id}
                    project={proj}
                    access={team.projectAccess[proj.id] ?? []}
                    organizationId={organizationId}
                    canManage={canManage}
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
          open={addingMember}
          onClose={() => setAddingMember(false)}
        />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function TeamsAndProjects() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const teams = api.team.getTeamsWithRoleBindings.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const canManage = hasPermission("team:manage");

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Box>
            <Heading size="md">Teams &amp; Projects</Heading>
            <Text fontSize="sm" color="gray.500" mt={1}>
              People on a team inherit access to all its projects. Expand a
              project to add overrides or direct access.
            </Text>
          </Box>
          <Spacer />
          {hasPermission("project:create") && (
            <PageLayout.HeaderButton onClick={() => openDrawer("createProject")}>
              <Plus size={16} />
              Add project
            </PageLayout.HeaderButton>
          )}
          {canManage && (
            <Link href="/settings/teams/new" asChild>
              <PageLayout.HeaderButton>
                <Plus size={16} />
                New team
              </PageLayout.HeaderButton>
            </Link>
          )}
        </HStack>

        {teams.isLoading && <Spinner />}

        {teams.data?.length === 0 && (
          <Text color="gray.500">No teams yet.</Text>
        )}

        <VStack gap={3} width="full" align="stretch">
          {teams.data?.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              organizationId={organization.id}
              canManage={canManage}
            />
          ))}
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("team:view", {
  layoutComponent: SettingsLayout,
})(TeamsAndProjects);
