import {
  Badge,
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Dialog } from "~/components/ui/dialog";
import { InputGroup } from "~/components/ui/input-group";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import type { RouterOutputs } from "~/utils/api";
import {
  BindingInputRow,
  roleBadgeColor,
  scopeTypeLabel,
  SourceBadge,
  type BindingInputRowHandle,
  type PendingBinding,
} from "./GroupBindingInputRow";

type Group = RouterOutputs["group"]["listAll"][number];
type PendingAddition = { userId: string; label: string };

export function GroupDetailDialog({
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

  // ── staged state ────────────────────────────────────────────────────────────
  const [pendingName, setPendingName] = useState(group.name);
  const [committedName, setCommittedName] = useState(group.name);

  const [pendingBindingRemovals, setPendingBindingRemovals] = useState<Set<string>>(new Set());
  const [pendingBindingAdditions, setPendingBindingAdditions] = useState<PendingBinding[]>([]);

  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  const [pendingAdditions, setPendingAdditions] = useState<PendingAddition[]>([]);

  const [addMemberId, setAddMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const bindingInputRef = useRef<BindingInputRowHandle>(null);

  const reset = () => {
    setPendingName(group.name);
    setCommittedName(group.name);
    setPendingBindingRemovals(new Set());
    setPendingBindingAdditions([]);
    setPendingRemovals(new Set());
    setPendingAdditions([]);
    setAddMemberId("");
    setMemberSearch("");
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group.id]);

  const nameChanged = pendingName.trim() !== committedName && pendingName.trim() !== "";
  const hasChanges =
    nameChanged ||
    pendingBindingRemovals.size > 0 ||
    pendingBindingAdditions.length > 0 ||
    pendingRemovals.size > 0 ||
    pendingAdditions.length > 0;

  // ── queries ─────────────────────────────────────────────────────────────────
  const detail = api.group.getById.useQuery(
    { organizationId, groupId: group.id },
    { enabled: open },
  );

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId },
    { enabled: open && canManage },
  );

  // ── mutations (used only inside handleSave) ──────────────────────────────────
  const renameGroup = api.group.rename.useMutation();
  const addBinding = api.group.addBinding.useMutation();
  const removeBinding = api.group.removeBinding.useMutation();
  const addMemberMutation = api.group.addMember.useMutation();
  const removeMemberMutation = api.group.removeMember.useMutation();

  // ── save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // Auto-stage any uncommitted binding row (user selected fields but didn't click Add)
    const uncommitted = bindingInputRef.current?.flush() ?? null;
    const allBindingAdditions = uncommitted
      ? [...pendingBindingAdditions, uncommitted]
      : pendingBindingAdditions;

    setIsSaving(true);
    try {
      if (nameChanged) {
        await renameGroup.mutateAsync({
          organizationId,
          groupId: group.id,
          name: pendingName.trim(),
        });
      }

      await Promise.all([
        ...[...pendingBindingRemovals].map((bindingId) =>
          removeBinding.mutateAsync({ organizationId, bindingId }),
        ),
        ...allBindingAdditions.map((b) =>
          addBinding.mutateAsync({
            organizationId,
            groupId: group.id,
            role: b.role as any,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          }),
        ),
        ...[...pendingRemovals].map((userId) =>
          removeMemberMutation.mutateAsync({ organizationId, groupId: group.id, userId }),
        ),
        ...pendingAdditions.map((a) =>
          addMemberMutation.mutateAsync({ organizationId, groupId: group.id, userId: a.userId }),
        ),
      ]);

      void queryClient.group.getById.invalidate();
      void queryClient.group.listAll.invalidate();
      toaster.create({ title: "Group updated", type: "success" });
      onClose();
    } catch (e: any) {
      toaster.create({ title: e?.message ?? "Failed to save", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  // ── helpers ──────────────────────────────────────────────────────────────────
  const toggleBindingRemoval = (id: string) =>
    setPendingBindingRemovals((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleMemberRemoval = (userId: string) =>
    setPendingRemovals((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });

  const stageMemberAdd = (userId: string, label: string) => {
    setPendingAdditions((prev) => [...prev, { userId, label }]);
    setAddMemberId("");
    setMemberSearch("");
  };

  const d = detail.data;

  const existingMemberIds = new Set([
    ...(d?.members.map((m) => m.userId) ?? []),
    ...pendingAdditions.map((a) => a.userId),
  ]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => { if (!e.open) { reset(); onClose(); } }}
      size="lg"
    >
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
              {canManage && !d.scimSource && (
                <Input
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  placeholder="Group name"
                  size="md"
                />
              )}
              <HStack>
                <SourceBadge scimSource={d.scimSource} />
                <Text fontSize="sm" color="fg.muted">
                  {Math.max(
                    0,
                    d.members.length -
                      pendingRemovals.size +
                      pendingAdditions.length,
                  )}{" "}
                  members
                </Text>
              </HStack>

              {/* ── Access bindings ── */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>Access granted</Text>

                {d.bindings.length === 0 && pendingBindingAdditions.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No access configured yet.
                  </Text>
                ) : (
                  <VStack gap={2} align="stretch">
                    {d.bindings.map((b) => {
                      const markedForRemoval = pendingBindingRemovals.has(b.id);
                      return (
                        <HStack
                          key={b.id}
                          px={3} py={2}
                          bg="bg.muted"
                          borderRadius="md"
                          fontSize="sm"
                          opacity={markedForRemoval ? 0.4 : 1}
                          transition="opacity 0.15s"
                        >
                          <Badge
                            colorPalette={roleBadgeColor(b.role)}
                            size="sm"
                            textDecoration={markedForRemoval ? "line-through" : undefined}
                          >
                            {b.customRoleName ?? b.role}
                          </Badge>
                          <Text color="fg.muted">on</Text>
                          <Badge
                            colorPalette="purple"
                            size="sm"
                            textDecoration={markedForRemoval ? "line-through" : undefined}
                          >
                            {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId}
                          </Badge>
                          <Spacer />
                          {canManage && (
                            <Button
                              size="xs"
                              variant="ghost"
                              color={markedForRemoval ? "blue.500" : "fg.muted"}
                              aria-label={markedForRemoval ? "Undo removal" : `Remove binding`}
                              onClick={() => toggleBindingRemoval(b.id)}
                            >
                              <X size={14} />
                            </Button>
                          )}
                        </HStack>
                      );
                    })}

                    {pendingBindingAdditions.map((b, i) => (
                      <HStack
                        key={i}
                        px={3} py={2}
                        bg="bg.muted"
                        borderRadius="md"
                        fontSize="sm"
                        opacity={0.7}
                      >
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
                          aria-label="Undo add"
                          onClick={() =>
                            setPendingBindingAdditions((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          <X size={14} />
                        </Button>
                      </HStack>
                    ))}
                  </VStack>
                )}

                {canManage && (
                  <BindingInputRow
                    ref={bindingInputRef}
                    organizationId={organizationId}
                    onAdd={(b) => setPendingBindingAdditions((prev) => [...prev, b])}
                  />
                )}
              </Box>

              {/* ── Members ── */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>Members</Text>
                {d.scimSource && (
                  <Box px={3} py={2} bg="bg.muted" borderRadius="md" mb={3} fontSize="sm" color="fg.muted">
                    Membership managed by {d.scimSource.toUpperCase()} via SCIM.
                  </Box>
                )}

                {d.members.length === 0 && pendingAdditions.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">No members yet.</Text>
                ) : (
                  <>
                    {d.members.map((m) => {
                      const markedForRemoval = pendingRemovals.has(m.userId);
                      return (
                        <HStack key={m.userId} py={1} fontSize="sm" opacity={markedForRemoval ? 0.4 : 1} transition="opacity 0.15s">
                          <RandomColorAvatar name={m.name ?? m.email ?? "?"} size="xs" />
                          <Text flex={1} textDecoration={markedForRemoval ? "line-through" : undefined}>
                            {m.name ?? m.email}
                          </Text>
                          {canManage && !d.scimSource && (
                            <Button
                              size="xs" variant="ghost"
                              color={markedForRemoval ? "blue.500" : "fg.muted"}
                              aria-label={markedForRemoval ? `Undo removal of ${m.name ?? m.email}` : `Mark ${m.name ?? m.email} for removal`}
                              onClick={() => toggleMemberRemoval(m.userId)}
                            >
                              <X size={14} />
                            </Button>
                          )}
                        </HStack>
                      );
                    })}
                    {pendingAdditions.map((a) => (
                      <HStack key={a.userId} py={1} fontSize="sm" opacity={0.7}>
                        <RandomColorAvatar name={a.label} size="xs" />
                        <Text flex={1} color="green.600">{a.label}</Text>
                        <Button
                          size="xs" variant="ghost" color="fg.muted"
                          aria-label={`Undo adding ${a.label}`}
                          onClick={() => setPendingAdditions((prev) => prev.filter((x) => x.userId !== a.userId))}
                        >
                          <X size={14} />
                        </Button>
                      </HStack>
                    ))}
                  </>
                )}

                {canManage && !d.scimSource && (() => {
                  const allAvailable = (orgMembers.data?.members ?? [])
                    .filter((m) => !existingMemberIds.has(m.userId))
                    .map((m) => ({
                      label: `${m.user.name ?? m.user.email} (${m.user.email})`,
                      value: m.userId,
                    }))
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
                        size="sm" flex={1}
                      >
                        <Select.Trigger>
                          <Select.ValueText placeholder="Add member..." />
                        </Select.Trigger>
                        <Select.Content>
                          <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
                            <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                              <Input
                                size="sm" placeholder="Search members..."
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                              />
                            </InputGroup>
                          </Box>
                          {availableItems.map((item) => (
                            <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                      <Button
                        size="sm"
                        colorPalette={addMemberId ? "blue" : undefined}
                        disabled={!addMemberId}
                        onClick={() => {
                          const item = allAvailable.find((a) => a.value === addMemberId);
                          if (item) stageMemberAdd(item.value, item.label);
                        }}
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

        {canManage && (
          <Dialog.Footer>
            <Button variant="outline" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!hasChanges}
              loading={isSaving}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
