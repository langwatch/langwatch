import { Dialog } from "@langwatch/design-system/dialog";
import { InputGroup } from "@langwatch/design-system/input-group";
import {
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { RouterOutputs } from "../../behavior/organization-api.ts";
import { api } from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import { directoryOwnershipCopy } from "../../model/group-source.ts";
import {
  GrantInputRow,
  type GrantInputRowHandle,
  DirectGrantRow,
  type PendingGrant,
  SourceBadge,
  StagedGrantRow,
  toggled,
} from "./group-grant-input-row.tsx";
import { MemberAvatar } from "./member-avatar.tsx";

type Group = RouterOutputs["group"]["listAll"][number];
type PendingAddition = { userId: string; label: string; image: string | null };

type GroupMember = {
  userId: string;
  name: string | null;
  email: string | null;
  image?: string | null;
};

function GroupMemberRow({
  member,
  markedForRemoval,
  removable,
  onToggle,
}: {
  member: GroupMember;
  markedForRemoval: boolean;
  removable: boolean;
  onToggle: () => void;
}) {
  const label = member.name ?? member.email;
  return (
    <HStack py={1} fontSize="sm" opacity={markedForRemoval ? 0.4 : 1} transition="opacity 0.15s">
      <MemberAvatar name={label ?? "?"} image={member.image} size="xs" />
      <Text flex={1} textDecoration={markedForRemoval ? "line-through" : undefined}>
        {label}
      </Text>
      {removable && (
        <Button
          size="xs"
          variant="ghost"
          color={markedForRemoval ? "blue.500" : "fg.muted"}
          aria-label={markedForRemoval ? `Undo removal of ${label}` : `Mark ${label} for removal`}
          onClick={onToggle}
        >
          <X size={14} />
        </Button>
      )}
    </HStack>
  );
}

function StagedMemberRow({ addition, onUndo }: { addition: PendingAddition; onUndo: () => void }) {
  return (
    <HStack py={1} fontSize="sm" opacity={0.7}>
      <MemberAvatar name={addition.label} image={addition.image} size="xs" />
      <Text flex={1} color="green.600">
        {addition.label}
      </Text>
      <Button
        size="xs"
        variant="ghost"
        color="fg.muted"
        aria-label={`Undo adding ${addition.label}`}
        onClick={onUndo}
      >
        <X size={14} />
      </Button>
    </HStack>
  );
}

type MemberCandidate = {
  userId: string;
  user: { name: string | null; email: string | null; image?: string | null };
};

function AddMemberPicker({
  candidates,
  existingMemberIds,
  search,
  onSearch,
  selected,
  onSelect,
  onAdd,
}: {
  candidates: MemberCandidate[];
  existingMemberIds: ReadonlySet<string>;
  search: string;
  onSearch: (search: string) => void;
  selected: string;
  onSelect: (userId: string) => void;
  onAdd: (addition: PendingAddition) => void;
}) {
  const allAvailable = candidates
    .filter((m) => !existingMemberIds.has(m.userId))
    .map((m) => ({
      label: `${m.user.name ?? m.user.email} (${m.user.email})`,
      value: m.userId,
      image: m.user.image ?? null,
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
  const needle = search.toLowerCase();
  const availableItems = search
    ? allAvailable.filter((m) => m.label.toLowerCase().includes(needle))
    : allAvailable;
  const availableCollection = createListCollection({ items: availableItems });
  const add = () => {
    const item = allAvailable.find((a) => a.value === selected);
    if (item) onAdd({ userId: item.value, label: item.label, image: item.image });
  };

  return (
    <HStack gap={2} mt={2}>
      <Select.Root
        collection={availableCollection}
        value={selected ? [selected] : []}
        onValueChange={(e) => onSelect(e.value[0] ?? "")}
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
                value={search}
                onChange={(e) => onSearch(e.target.value)}
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
        colorPalette={selected ? "blue" : undefined}
        disabled={!selected}
        onClick={add}
      >
        Add
      </Button>
    </HStack>
  );
}

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
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();

  // ── staged state ────────────────────────────────────────────────────────────
  const [pendingName, setPendingName] = useState(group.name);
  const [committedName, setCommittedName] = useState(group.name);

  const [pendingGrantRemovals, setPendingGrantRemovals] = useState<Set<string>>(new Set());
  const [pendingGrantAdditions, setPendingGrantAdditions] = useState<PendingGrant[]>([]);

  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(new Set());
  const [pendingAdditions, setPendingAdditions] = useState<PendingAddition[]>([]);

  const [addMemberId, setAddMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const grantInputRef = useRef<GrantInputRowHandle>(null);

  const reset = () => {
    setPendingName(group.name);
    setCommittedName(group.name);
    setPendingGrantRemovals(new Set());
    setPendingGrantAdditions([]);
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
    pendingGrantRemovals.size > 0 ||
    pendingGrantAdditions.length > 0 ||
    pendingRemovals.size > 0 ||
    pendingAdditions.length > 0;

  // ── queries ─────────────────────────────────────────────────────────────────
  const detail = api.group.getById.useQuery(
    { organizationId, groupId: group.id },
    { enabled: open },
  );

  const orgMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId, includeDeactivated: false },
    { enabled: open && canManage },
  );

  // ── mutations ────────────────────────────────────────────────────────────────
  const applyEdits = api.group.applyEdits.useMutation();

  // ── save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // Auto-stage any uncommitted grant row (user selected fields but didn't click Add)
    const uncommitted = grantInputRef.current?.flush() ?? null;
    const allGrantAdditions = uncommitted
      ? [...pendingGrantAdditions, uncommitted]
      : pendingGrantAdditions;

    setIsSaving(true);
    try {
      await applyEdits.mutateAsync({
        organizationId,
        groupId: group.id,
        rename: nameChanged ? { name: pendingName.trim() } : null,
        grantIdsToRevoke: [...pendingGrantRemovals],
        grantsToCreate: allGrantAdditions.map((b) => ({
          role: b.role,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })),
        memberUserIdsToAdd: pendingAdditions.map((a) => a.userId),
        memberUserIdsToRemove: [...pendingRemovals],
      });

      void queryClient.group.getById.invalidate();
      void queryClient.group.listAll.invalidate();
      toaster.create({ title: "Group updated", type: "success" });
      onClose();
    } catch (e) {
      showErrorToast({ error: e, fallbackTitle: "Couldn't update this group" });
    } finally {
      setIsSaving(false);
    }
  };

  // ── helpers ──────────────────────────────────────────────────────────────────
  const toggleGrantRemoval = (id: string) =>
    setPendingGrantRemovals((prev) => toggled({ set: prev, id }));

  const toggleMemberRemoval = (userId: string) =>
    setPendingRemovals((prev) => toggled({ set: prev, id: userId }));

  const stageMemberAdd = ({
    userId,
    label,
    image,
  }: {
    userId: string;
    label: string;
    image: string | null;
  }) => {
    setPendingAdditions((prev) => [...prev, { userId, label, image }]);
    setAddMemberId("");
    setMemberSearch("");
  };

  const d = detail.data;

  const existingMemberIds = new Set([
    ...(d?.members.map((m) => m.userId) ?? []),
    ...pendingAdditions.map((a) => a.userId),
  ]);

  const isLoadingDetail = detail.isLoading;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          reset();
          onClose();
        }
      }}
      size="lg"
    >
      <Dialog.Content bg="bg" maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{group.name}</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body pb={6}>
          {isLoadingDetail && <Spinner />}
          {!isLoadingDetail && d && (
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
                  {Math.max(0, d.members.length - pendingRemovals.size + pendingAdditions.length)}{" "}
                  members
                </Text>
              </HStack>

              {/* ── Access grants ── */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={3}>
                  Access granted
                </Text>

                {d.grants.length === 0 && pendingGrantAdditions.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No access configured yet.
                  </Text>
                ) : (
                  <VStack gap={2} align="stretch">
                    {d.grants.map((b) => (
                      <DirectGrantRow
                        key={b.id}
                        grant={b}
                        markedForRemoval={pendingGrantRemovals.has(b.id)}
                        removable={canManage}
                        onToggle={() => toggleGrantRemoval(b.id)}
                      />
                    ))}
                    {pendingGrantAdditions.map((b, i) => (
                      <StagedGrantRow
                        key={i}
                        grant={b}
                        onUndo={() =>
                          setPendingGrantAdditions((prev) => prev.filter((_, j) => j !== i))
                        }
                      />
                    ))}
                  </VStack>
                )}

                {canManage && (
                  <GrantInputRow
                    ref={grantInputRef}
                    organizationId={organizationId}
                    onAdd={(b) => setPendingGrantAdditions((prev) => [...prev, b])}
                  />
                )}
              </Box>

              {/* ── Members ── */}
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
                    {directoryOwnershipCopy({ source: d.scimSource })}
                  </Box>
                )}

                {d.members.length === 0 && pendingAdditions.length === 0 ? (
                  <Text fontSize="sm" color="fg.muted" fontStyle="italic">
                    No members yet.
                  </Text>
                ) : (
                  <>
                    {d.members.map((m) => (
                      <GroupMemberRow
                        key={m.userId}
                        member={m}
                        markedForRemoval={pendingRemovals.has(m.userId)}
                        removable={canManage && !d.scimSource}
                        onToggle={() => toggleMemberRemoval(m.userId)}
                      />
                    ))}
                    {pendingAdditions.map((a) => (
                      <StagedMemberRow
                        key={a.userId}
                        addition={a}
                        onUndo={() =>
                          setPendingAdditions((prev) => prev.filter((x) => x.userId !== a.userId))
                        }
                      />
                    ))}
                  </>
                )}

                {canManage && !d.scimSource && (
                  <AddMemberPicker
                    candidates={orgMembers.data?.members ?? []}
                    existingMemberIds={existingMemberIds}
                    search={memberSearch}
                    onSearch={setMemberSearch}
                    selected={addMemberId}
                    onSelect={setAddMemberId}
                    onAdd={stageMemberAdd}
                  />
                )}
              </Box>
            </VStack>
          )}
        </Dialog.Body>

        {canManage && (
          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
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
