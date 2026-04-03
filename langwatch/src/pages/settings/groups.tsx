import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  createListCollection,
  Field,
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
import { Select } from "~/components/ui/select";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
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

const ROLE_ITEMS = [
  { label: "Admin", value: "ADMIN" },
  { label: "Member", value: "MEMBER" },
  { label: "Viewer", value: "VIEWER" },
];
const roleCollection = createListCollection({ items: ROLE_ITEMS });

function AddBindingForm({
  organizationId,
  groupId,
  onAdded,
}: {
  organizationId: string;
  groupId: string;
  onAdded: () => void;
}) {
  const [scopeType, setScopeType] = useState<RoleBindingScopeType>(
    RoleBindingScopeType.TEAM,
  );
  const [scopeId, setScopeId] = useState("");
  const [role, setRole] = useState("MEMBER");

  const teams = api.team.getTeamsWithMembers.useQuery({ organizationId });

  const teamItems = (teams.data ?? []).map((t) => ({
    label: t.name,
    value: t.id,
  }));
  const teamCollection = createListCollection({ items: teamItems });

  const projectItems = (teams.data ?? [])
    .flatMap((t) => t.projects.map((p) => ({ label: p.name, value: p.id })))
    .sort((a, b) => a.label.localeCompare(b.label));
  const projectCollection = createListCollection({ items: projectItems });

  const addBinding = api.group.addBinding.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Binding added", type: "success" });
      setScopeId("");
      onAdded();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  return (
    <HStack gap={2} mt={2} flexWrap="wrap">
      <Select.Root
        collection={roleCollection}
        value={[role]}
        onValueChange={(e) => setRole(e.value[0] ?? "MEMBER")}
        size="sm"
        width="120px"
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Role..." />
        </Select.Trigger>
        <Select.Content>
          {ROLE_ITEMS.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <Text fontSize="sm" color="fg.muted">
        on
      </Text>

      <Select.Root
        collection={scopeTypeCollection}
        value={[scopeType]}
        onValueChange={(e) => {
          setScopeType((e.value[0] as RoleBindingScopeType) ?? RoleBindingScopeType.TEAM);
          setScopeId("");
        }}
        size="sm"
        width="130px"
      >
        <Select.Trigger>
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {SCOPE_TYPE_ITEMS.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
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
          <Select.Trigger>
            <Select.ValueText placeholder="Select team..." />
          </Select.Trigger>
          <Select.Content>
            {teamItems.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      {scopeType === RoleBindingScopeType.ORGANIZATION && (
        <Text fontSize="sm" color="fg.muted" minWidth="160px">
          (whole organization)
        </Text>
      )}

      {scopeType === RoleBindingScopeType.PROJECT && (
        <Select.Root
          collection={projectCollection}
          value={scopeId ? [scopeId] : []}
          onValueChange={(e) => setScopeId(e.value[0] ?? "")}
          size="sm"
          width="160px"
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Select project..." />
          </Select.Trigger>
          <Select.Content>
            {projectItems.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      <Button
        size="sm"
        disabled={!scopeId && scopeType !== RoleBindingScopeType.ORGANIZATION}
        loading={addBinding.isPending}
        onClick={() =>
          addBinding.mutate({
            organizationId,
            groupId,
            role: role as any,
            scopeType,
            scopeId:
              scopeType === RoleBindingScopeType.ORGANIZATION
                ? organizationId
                : scopeId,
          })
        }
      >
        Add
      </Button>
    </HStack>
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const removeMember = api.group.removeMember.useMutation({
    onSuccess: () => void queryClient.group.getById.invalidate(),
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const deleteGroup = api.group.delete.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group deleted", type: "success" });
      void queryClient.group.listAll.invalidate();
      onClose();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const d = detail.data;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) { setConfirmDelete(false); onClose(); } }} size="lg">
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
                          {b.role}
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
              </Box>
            </VStack>
          )}
        </Dialog.Body>

        {canManage && (
          <Dialog.Footer borderTop="1px solid" borderColor="border.muted" pt={4}>
            {confirmDelete ? (
              <HStack gap={2} width="full">
                <Text fontSize="sm" color="fg.muted" flex={1}>
                  {group.scimSource
                    ? "This SCIM group will be re-created by your IdP on next sync. Delete anyway?"
                    : "Delete this group and all its access rules?"}
                </Text>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  colorPalette="red"
                  loading={deleteGroup.isPending}
                  onClick={() => deleteGroup.mutate({ organizationId, groupId: group.id })}
                >
                  Delete
                </Button>
              </HStack>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                color="fg.muted"
                _hover={{ color: "red.500" }}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Delete group
              </Button>
            )}
          </Dialog.Footer>
        )}
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
  const [name, setName] = useState("");
  const queryClient = api.useContext();

  const create = api.group.create.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group created", type: "success" });
      void queryClient.group.listAll.invalidate();
      setName("");
      onClose();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content maxWidth="440px">
        <Dialog.Header>
          <Dialog.Title>Create group</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <Field.Root>
            <Field.Label>Group name</Field.Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. platform-engineers"
            />
          </Field.Root>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            disabled={!name.trim()}
            loading={create.isPending}
            onClick={() => create.mutate({ organizationId, name: name.trim() })}
          >
            Create
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
          <Spacer />
          {canManage && (
            <PageLayout.HeaderButton onClick={() => setCreating(true)}>
              <Plus size={16} />
              Create group
            </PageLayout.HeaderButton>
          )}
        </HStack>

        <Separator />

        {groups.isLoading && <Spinner />}

        {groups.data && groups.data.length === 0 && (
          <Text color="fg.muted">
            No groups yet. Create a manual group or connect your identity
            provider via SCIM.
          </Text>
        )}

        {groups.data && groups.data.length > 0 && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0}>
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Group</Table.ColumnHeader>
                    <Table.ColumnHeader width="120px">Source</Table.ColumnHeader>
                    <Table.ColumnHeader>Access</Table.ColumnHeader>
                    <Table.ColumnHeader width="80px" textAlign="right">
                      Members
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {groups.data.map((g) => (
                    <Table.Row
                      key={g.id}
                      cursor="pointer"
                      onClick={() => setSelectedGroup(g)}
                      _hover={{ bg: "bg.muted" }}
                    >
                      <Table.Cell fontWeight="medium">{g.name}</Table.Cell>
                      <Table.Cell>
                        <SourceBadge scimSource={g.scimSource} />
                      </Table.Cell>
                      <Table.Cell>
                        <HStack gap={2} flexWrap="wrap">
                          {g.bindings.map((b, i) => (
                            <HStack key={i} gap={1} fontSize="xs">
                              <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
                                {b.role}
                              </Badge>
                              <Text color="fg.muted">on</Text>
                              <Badge colorPalette="purple" size="sm">
                                {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
                              </Badge>
                            </HStack>
                          ))}
                          {g.bindings.length === 0 && (
                            <Text fontSize="xs" color="fg.subtle">
                              No access configured
                            </Text>
                          )}
                        </HStack>
                      </Table.Cell>
                      <Table.Cell textAlign="right">
                        <Text fontSize="sm" color="fg.muted">
                          {g.memberCount}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
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
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(GroupsSettings);
