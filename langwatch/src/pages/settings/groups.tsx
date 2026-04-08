import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  Heading,
  HStack,
  Input,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import { InputGroup } from "~/components/ui/input-group";
import { Menu } from "~/components/ui/menu";
import { Select } from "~/components/ui/select";
import { Plus, Search, Trash2, X } from "lucide-react";
import { MoreVertical } from "react-feather";
import { useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { toaster } from "~/components/ui/toaster";
import { ContactSalesBlock } from "../../components/subscription/ContactSalesBlock";
import SettingsLayout from "../../components/SettingsLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useActivePlan } from "../../hooks/useActivePlan";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { RouterOutputs } from "../../utils/api";
import { RoleBindingScopeType } from "@prisma/client";

type Group = RouterOutputs["group"]["listAll"][number];
type GroupDetail = RouterOutputs["group"]["getById"];

// ── Scope label helper ────────────────────────────────────────────────────────

function scopeTypeLabel(type: RoleBindingScopeType) {
  if (type === RoleBindingScopeType.ORGANIZATION) return "🏢";
  if (type === RoleBindingScopeType.TEAM) return "👥";
  return "📁";
}

function roleBadgeColor(role: string) {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  return "gray";
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ scimSource }: { scimSource: string | null }) {
  if (!scimSource) return <Badge colorPalette="gray">Manual</Badge>;
  return <Badge colorPalette="blue">{scimSource.toUpperCase()}</Badge>;
}

// ── Add binding form (inside group detail dialog) ─────────────────────────────

const SCOPE_TYPE_ITEMS = [
  { label: "Organization", value: RoleBindingScopeType.ORGANIZATION },
  { label: "Team", value: RoleBindingScopeType.TEAM },
  { label: "Project", value: RoleBindingScopeType.PROJECT },
];
const scopeTypeCollection = createListCollection({ items: SCOPE_TYPE_ITEMS });

const BASE_ROLE_ITEMS = [
  { label: "Admin", value: "ADMIN", customRoleId: undefined as string | undefined },
  { label: "Member", value: "MEMBER", customRoleId: undefined as string | undefined },
  { label: "Viewer", value: "VIEWER", customRoleId: undefined as string | undefined },
];

type PendingBinding = {
  roleValue: string;
  role: string;
  customRoleId?: string;
  customRoleName?: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  scopeName?: string;
};

// ── Shared binding input row ──────────────────────────────────────────────────

function BindingInputRow({
  organizationId,
  onAdd,
  buttonLabel = "Add",
  isPending = false,
}: {
  organizationId: string;
  onAdd: (binding: PendingBinding) => void;
  buttonLabel?: string;
  isPending?: boolean;
}) {
  const [scopeType, setScopeType] = useState<RoleBindingScopeType>(RoleBindingScopeType.TEAM);
  const [scopeId, setScopeId] = useState("");
  const [roleValue, setRoleValue] = useState("MEMBER");
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(undefined);
  const [teamSearch, setTeamSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");

  const teams = api.team.getTeamsWithMembers.useQuery({ organizationId });
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const roleItems = [
    ...BASE_ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({
      label: r.name,
      value: `CUSTOM:${r.id}`,
      customRoleId: r.id,
    })),
  ];
  const roleCollection = createListCollection({ items: roleItems });

  const allTeamItems = (teams.data ?? []).map((t) => ({ label: t.name, value: t.id }));
  const teamItems = teamSearch
    ? allTeamItems.filter((t) => t.label.toLowerCase().includes(teamSearch.toLowerCase()))
    : allTeamItems;
  const teamCollection = createListCollection({ items: teamItems });

  const allProjectItems = (teams.data ?? [])
    .flatMap((t) => t.projects.map((p) => ({ label: p.name, value: p.id })))
    .sort((a, b) => a.label.localeCompare(b.label));
  const projectItems = projectSearch
    ? allProjectItems.filter((p) => p.label.toLowerCase().includes(projectSearch.toLowerCase()))
    : allProjectItems;
  const projectCollection = createListCollection({ items: projectItems });

  function getScopeName() {
    if (scopeType === RoleBindingScopeType.TEAM)
      return allTeamItems.find((t) => t.value === scopeId)?.label;
    if (scopeType === RoleBindingScopeType.PROJECT)
      return allProjectItems.find((p) => p.value === scopeId)?.label;
    return undefined;
  }

  function handleAdd() {
    const cid = customRoleId;
    const cname = cid ? customRoles.data?.find((r) => r.id === cid)?.name : undefined;
    onAdd({
      roleValue,
      role: cid ? "CUSTOM" : roleValue,
      customRoleId: cid,
      customRoleName: cname,
      scopeType,
      scopeId: scopeType === RoleBindingScopeType.ORGANIZATION ? organizationId : scopeId,
      scopeName: getScopeName(),
    });
    setScopeId("");
  }

  return (
    <HStack gap={2} mt={2} flexWrap="wrap">
      <Select.Root
        collection={roleCollection}
        value={[roleValue]}
        onValueChange={(e) => {
          const v = e.value[0] ?? "MEMBER";
          if (v.startsWith("CUSTOM:")) {
            setRoleValue(v);
            setCustomRoleId(v.slice(7));
          } else {
            setRoleValue(v);
            setCustomRoleId(undefined);
          }
        }}
        size="sm"
        width="160px"
      >
        <Select.Trigger><Select.ValueText placeholder="Role..." /></Select.Trigger>
        <Select.Content>
          {roleItems.map((item) => (
            <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <Text fontSize="sm" color="fg.muted">on</Text>

      <Select.Root
        collection={scopeTypeCollection}
        value={[scopeType]}
        onValueChange={(e) => {
          setScopeType((e.value[0] as RoleBindingScopeType) ?? RoleBindingScopeType.TEAM);
          setScopeId("");
          setTeamSearch("");
          setProjectSearch("");
        }}
        size="sm"
        width="130px"
      >
        <Select.Trigger><Select.ValueText /></Select.Trigger>
        <Select.Content>
          {SCOPE_TYPE_ITEMS.map((item) => (
            <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      {scopeType === RoleBindingScopeType.TEAM && (
        <Select.Root
          collection={teamCollection}
          value={scopeId ? [scopeId] : []}
          onValueChange={(e) => setScopeId(e.value[0] ?? "")}
          size="sm"
          width="160px"
        >
          <Select.Trigger><Select.ValueText placeholder="Select team..." /></Select.Trigger>
          <Select.Content>
            <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
              <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                <Input
                  size="sm"
                  placeholder="Search teams..."
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </InputGroup>
            </Box>
            {teamItems.map((item) => (
              <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      {scopeType === RoleBindingScopeType.ORGANIZATION && (
        <Text fontSize="sm" color="fg.muted" minWidth="160px">(whole organization)</Text>
      )}

      {scopeType === RoleBindingScopeType.PROJECT && (
        <Select.Root
          collection={projectCollection}
          value={scopeId ? [scopeId] : []}
          onValueChange={(e) => setScopeId(e.value[0] ?? "")}
          size="sm"
          width="160px"
        >
          <Select.Trigger><Select.ValueText placeholder="Select project..." /></Select.Trigger>
          <Select.Content>
            <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
              <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                <Input
                  size="sm"
                  placeholder="Search projects..."
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </InputGroup>
            </Box>
            {projectItems.map((item) => (
              <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      <Button
        size="sm"
        disabled={!scopeId && scopeType !== RoleBindingScopeType.ORGANIZATION}
        loading={isPending}
        onClick={handleAdd}
      >
        {buttonLabel}
      </Button>
    </HStack>
  );
}

// ── Live add-binding form (existing group) ────────────────────────────────────

function AddBindingForm({
  organizationId,
  groupId,
  onAdded,
}: {
  organizationId: string;
  groupId: string;
  onAdded: () => void;
}) {
  const addBinding = api.group.addBinding.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Binding added", type: "success" });
      onAdded();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  return (
    <BindingInputRow
      organizationId={organizationId}
      isPending={addBinding.isPending}
      onAdd={(b) =>
        addBinding.mutate({
          organizationId,
          groupId,
          role: b.role as any,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })
      }
    />
  );
}

// ── Group detail dialog ───────────────────────────────────────────────────────

function GroupDetailDialog({
  group,
  organizationId,
  canManage,
  open,
  onClose,
}: {
  group: Group;
  organizationId: string;
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = api.useContext();
  const [addMemberId, setAddMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const detail = api.group.getById.useQuery(
    { organizationId, groupId: group.id },
    { enabled: open },
  );

  const removeBinding = api.group.removeBinding.useMutation({
    onSuccess: () => {
      void queryClient.group.getById.invalidate();
      void queryClient.group.listAll.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId },
    { enabled: open && canManage },
  );

  const removeMember = api.group.removeMember.useMutation({
    onSuccess: () => void queryClient.group.getById.invalidate(),
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const addMember = api.group.addMember.useMutation({
    onSuccess: () => {
      setAddMemberId("");
      void queryClient.group.getById.invalidate();
      void queryClient.group.listAll.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const d = detail.data;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) { setAddMemberId(""); setMemberSearch(""); onClose(); } }} size="lg">
      <Dialog.Content maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{group.name}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body pb={6}>
          {detail.isLoading ? (
            <Spinner />
          ) : !d ? null : (
            <VStack gap={5} align="stretch">
              <HStack>
                <SourceBadge scimSource={d.scimSource} />
                <Text fontSize="sm" color="fg.muted">
                  {d.members.length} members
                </Text>
              </HStack>

              {/* Bindings */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>
                  Access granted
                </Text>
                {d.bindings.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No access configured yet.
                  </Text>
                ) : (
                  <VStack gap={2} align="stretch">
                    {d.bindings.map((b) => (
                      <HStack
                        key={b.id}
                        px={3}
                        py={2}
                        bg="bg.muted"
                        borderRadius="md"
                        fontSize="sm"
                      >
                        <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                          {b.customRoleName ?? b.role}
                        </Badge>
                        <Text color="fg.muted">on</Text>
                        <Badge colorPalette="purple" size="sm">
                          {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
                        </Badge>
                        <Spacer />
                        {canManage && (
                          <Button
                            size="xs"
                            variant="ghost"
                            color="fg.muted"
                            aria-label={`Remove ${b.customRoleName ?? b.role} binding on ${b.scopeName ?? b.scopeId}`}
                            loading={removeBinding.isPending}
                            onClick={() =>
                              removeBinding.mutate({
                                organizationId,
                                bindingId: b.id,
                              })
                            }
                          >
                            <X size={14} />
                          </Button>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                )}

                {canManage && (
                  <AddBindingForm
                    organizationId={organizationId}
                    groupId={group.id}
                    onAdded={() => {
                      void queryClient.group.getById.invalidate();
                      void queryClient.group.listAll.invalidate();
                    }}
                  />
                )}
              </Box>

              {/* Members */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>
                  Members
                </Text>
                {d.scimSource && (
                  <Box
                    px={3}
                    py={2}
                    bg="bg.muted"
                    borderRadius="md"
                    mb={3}
                    fontSize="sm"
                    color="fg.muted"
                  >
                    Membership managed by {d.scimSource.toUpperCase()} via SCIM.
                  </Box>
                )}
                {d.members.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No members yet.
                  </Text>
                ) : (
                  d.members.map((m) => (
                    <HStack key={m.userId} py={1} fontSize="sm">
                      <RandomColorAvatar
                        name={m.name ?? m.email ?? "?"}
                        size="xs"
                      />
                      <Text flex={1}>{m.name ?? m.email}</Text>
                      {canManage && !d.scimSource && (
                        <Button
                          size="xs"
                          variant="ghost"
                          color="fg.muted"
                          aria-label={`Remove ${m.name ?? m.email} from group`}
                          loading={removeMember.isPending}
                          onClick={() =>
                            removeMember.mutate({
                              organizationId,
                              groupId: group.id,
                              userId: m.userId,
                            })
                          }
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </HStack>
                  ))
                )}

                {canManage && !d.scimSource && (() => {
                  const existingIds = new Set(d.members.map((m) => m.userId));
                  const allAvailable = (orgMembers.data?.members ?? [])
                    .filter((m) => !existingIds.has(m.userId))
                    .map((m) => ({ label: `${m.user.name ?? m.user.email} (${m.user.email})`, value: m.userId }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                  const availableItems = memberSearch
                    ? allAvailable.filter((m) => m.label.toLowerCase().includes(memberSearch.toLowerCase()))
                    : allAvailable;
                  const availableCollection = createListCollection({ items: availableItems });

                  return (
                    <HStack gap={2} mt={2}>
                      <Select.Root
                        collection={availableCollection}
                        value={addMemberId ? [addMemberId] : []}
                        onValueChange={(e) => setAddMemberId(e.value[0] ?? "")}
                        size="sm"
                        flex={1}
                      >
                        <Select.Trigger>
                          <Select.ValueText placeholder="Add member..." />
                        </Select.Trigger>
                        <Select.Content>
                          <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
                            <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                              <Input
                                size="sm"
                                placeholder="Search members..."
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                              />
                            </InputGroup>
                          </Box>
                          {availableItems.map((item) => (
                            <Select.Item key={item.value} item={item}>
                              {item.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Button
                        size="sm"
                        disabled={!addMemberId}
                        loading={addMember.isPending}
                        onClick={() =>
                          addMember.mutate({ organizationId, groupId: group.id, userId: addMemberId })
                        }
                      >
                        Add
                      </Button>
                    </HStack>
                  );
                })()}
              </Box>
            </VStack>
          )}
        </Dialog.Body>

      </Dialog.Content>
    </Dialog.Root>
  );
}


// ── Create group dialog ───────────────────────────────────────────────────────

function CreateGroupDialog({
  organizationId,
  open,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = api.useContext();
  const [name, setName] = useState("");
  const [pendingBindings, setPendingBindings] = useState<PendingBinding[]>([]);
  const [pendingMemberIds, setPendingMemberIds] = useState<string[]>([]);
  const [addMemberId, setAddMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId },
    { enabled: open },
  );

  const createGroup = api.group.create.useMutation();

  const isSubmitting = createGroup.isPending;

  function reset() {
    setName("");
    setPendingBindings([]);
    setPendingMemberIds([]);
    setAddMemberId("");
    setMemberSearch("");
  }

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createGroup.mutateAsync({
        organizationId,
        name: name.trim(),
        bindings: pendingBindings.map((b) => ({
          role: b.role as any,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })),
        memberIds: pendingMemberIds,
      });
      void queryClient.group.listAll.invalidate();
      reset();
      onClose();
    } catch (e: any) {
      toaster.create({ title: e.message ?? "Failed to create group", type: "error" });
    }
  }

  const allAvailableMembers = (orgMembers.data?.members ?? [])
    .filter((m) => !pendingMemberIds.includes(m.userId))
    .map((m) => ({ label: `${m.user.name ?? m.user.email} (${m.user.email})`, value: m.userId }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const availableMemberItems = memberSearch
    ? allAvailableMembers.filter((m) => m.label.toLowerCase().includes(memberSearch.toLowerCase()))
    : allAvailableMembers;
  const availableMemberCollection = createListCollection({ items: availableMemberItems });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) { reset(); onClose(); } }} size="lg">
      <Dialog.Content maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>Create group</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body pb={6}>
          <VStack gap={5} align="stretch">
            <Input
              autoFocus
              placeholder="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {/* Bindings */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" mb={3}>Access</Text>
              {pendingBindings.length > 0 && (
                <VStack gap={2} align="stretch" mb={2}>
                  {pendingBindings.map((b, i) => (
                    <HStack key={i} px={3} py={2} bg="bg.muted" borderRadius="md" fontSize="sm">
                      <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                        {b.customRoleName ?? b.role}
                      </Badge>
                      <Text color="fg.muted">on</Text>
                      <Badge colorPalette="purple" size="sm">
                        {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
                      </Badge>
                      <Spacer />
                      <Button
                        size="xs"
                        variant="ghost"
                        color="fg.muted"
                        aria-label={`Remove ${b.customRoleName ?? b.role} binding on ${b.scopeName ?? b.scopeId}`}
                        onClick={() => setPendingBindings((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X size={14} />
                      </Button>
                    </HStack>
                  ))}
                </VStack>
              )}
              <BindingInputRow
                organizationId={organizationId}
                onAdd={(b) => setPendingBindings((prev) => [...prev, b])}
              />
            </Box>

            {/* Members */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" mb={3}>Members</Text>
              {pendingMemberIds.length > 0 && (
                <VStack gap={1} align="stretch" mb={2}>
                  {pendingMemberIds.map((userId) => {
                    const member = orgMembers.data?.members.find((m) => m.userId === userId);
                    return (
                      <HStack key={userId} py={1} fontSize="sm">
                        <RandomColorAvatar
                          name={member?.user.name ?? member?.user.email ?? "?"}
                          size="xs"
                        />
                        <Text flex={1}>{member?.user.name ?? member?.user.email ?? userId}</Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="fg.muted"
                          aria-label={`Remove ${member?.user.name ?? member?.user.email ?? userId} from group`}
                          onClick={() => setPendingMemberIds((prev) => prev.filter((id) => id !== userId))}
                        >
                          <X size={14} />
                        </Button>
                      </HStack>
                    );
                  })}
                </VStack>
              )}
              <HStack gap={2} mt={2}>
                <Select.Root
                  collection={availableMemberCollection}
                  value={addMemberId ? [addMemberId] : []}
                  onValueChange={(e) => {
                    const uid = e.value[0];
                    if (uid) {
                      setPendingMemberIds((prev) => [...prev, uid]);
                      setAddMemberId("");
                    }
                  }}
                  size="sm"
                  flex={1}
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Add member..." />
                  </Select.Trigger>
                  <Select.Content>
                    <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
                      <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                        <Input
                          size="sm"
                          placeholder="Search members..."
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </InputGroup>
                    </Box>
                    {availableMemberItems.map((item) => (
                      <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </HStack>
            </Box>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button
            colorPalette="blue"
            disabled={!name.trim()}
            loading={isSubmitting}
            onClick={() => void handleCreate()}
          >
            Create group
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function GroupsSettings() {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { isEnterprise } = useActivePlan();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const queryClient = api.useContext();

  const deleteGroup = api.group.delete.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group deleted", type: "success" });
      void queryClient.group.listAll.invalidate();
      setGroupToDelete(null);
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const groups = api.group.listAll.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization && isEnterprise },
  );

  const canManage = hasPermission("organization:manage");

  if (!organization) return <SettingsLayout />;

  if (!isEnterprise) {
    return (
      <SettingsLayout>
        <VStack gap={6} align="start" width="full">
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Enterprise Feature</Alert.Title>
              <Alert.Description>
                Groups are available on Enterprise plans. Contact sales to upgrade.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Box width="full">
            <ContactSalesBlock />
          </Box>
        </VStack>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack justify="space-between" width="full">
          <VStack align="start" gap={1}>
            <Heading as="h2">Groups</Heading>
            <Text color="fg.muted" fontSize="sm">
              Assign access to many people at once. SCIM-synced groups are
              managed by your identity provider.
            </Text>
          </VStack>
        </HStack>

        <Separator />

        {groups.isLoading && <Spinner />}

        {!groups.isLoading && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0}>
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Group</Table.ColumnHeader>
                    <Table.ColumnHeader width="120px">Source</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="right">Access</Table.ColumnHeader>
                    <Table.ColumnHeader width="80px" textAlign="right">Members</Table.ColumnHeader>
                    {canManage && <Table.ColumnHeader width="48px" />}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {(groups.data ?? []).map((g) => (
                    <Table.Row
                      key={g.id}
                      cursor="pointer"
                      onClick={() => setSelectedGroup(g)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedGroup(g); } }}
                      tabIndex={0}
                      role="button"
                      _hover={{ bg: "bg.muted" }}
                    >
                      <Table.Cell fontWeight="medium">{g.name}</Table.Cell>
                      <Table.Cell>
                        <SourceBadge scimSource={g.scimSource} />
                      </Table.Cell>
                      <Table.Cell>
                        <VStack gap={1} align="end">
                          {g.bindings.map((b, i) => (
                            <HStack key={i} gap={1} fontSize="xs">
                              <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                                {b.customRoleName ?? b.role}
                              </Badge>
                              <Text color="fg.muted">on</Text>
                              <Badge colorPalette="purple" size="sm">
                                {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
                              </Badge>
                            </HStack>
                          ))}
                          {g.bindings.length === 0 && (
                            <Text fontSize="xs" color="fg.subtle" textAlign="right">
                              No access configured
                            </Text>
                          )}
                        </VStack>
                      </Table.Cell>
                      <Table.Cell textAlign="right">
                        <Text fontSize="sm" color="fg.muted">
                          {g.memberCount}
                        </Text>
                      </Table.Cell>
                      {canManage && (
                        <Table.Cell>
                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <Button
                                variant="ghost"
                                size="xs"
                                aria-label={`Actions for ${g.name}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical size={16} />
                              </Button>
                            </Menu.Trigger>
                            <Menu.Content>
                              <Menu.Item
                                value="delete"
                                color="red.500"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setGroupToDelete(g);
                                }}
                              >
                                <Box display="flex" alignItems="center" gap={2}>
                                  <Trash2 size={14} />
                                  Delete
                                </Box>
                              </Menu.Item>
                            </Menu.Content>
                          </Menu.Root>
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                  {canManage && (
                    <Table.Row
                      cursor="pointer"
                      onClick={() => setCreating(true)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCreating(true); } }}
                      tabIndex={0}
                      role="button"
                      _hover={{ bg: "bg.muted" }}
                      color="fg.muted"
                    >
                      <Table.Cell colSpan={5}>
                        <HStack gap={2}>
                          <Plus size={14} />
                          <Text fontSize="sm">Add manual group</Text>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        )}
      </VStack>

      {selectedGroup && (
        <GroupDetailDialog
          group={selectedGroup}
          organizationId={organization.id}
          canManage={canManage}
          open={!!selectedGroup}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      <CreateGroupDialog
        organizationId={organization.id}
        open={creating}
        onClose={() => setCreating(false)}
      />

      <Dialog.Root open={!!groupToDelete} onOpenChange={(e) => { if (!e.open) setGroupToDelete(null); }}>
        <Dialog.Content maxWidth="440px">
          <Dialog.Header>
            <Dialog.Title>Delete group</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <Text fontSize="sm">
              {groupToDelete?.scimSource
                ? "This SCIM group will be re-created by your IdP on next sync. Delete anyway?"
                : `Delete "${groupToDelete?.name}" and all its access rules?`}
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setGroupToDelete(null)}>Cancel</Button>
            <Button
              colorPalette="red"
              loading={deleteGroup.isPending}
              onClick={() =>
                groupToDelete &&
                deleteGroup.mutate({ organizationId: organization.id, groupId: groupToDelete.id })
              }
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(GroupsSettings);
