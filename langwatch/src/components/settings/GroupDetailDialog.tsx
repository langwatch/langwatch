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
import { useEffect, useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Dialog } from "~/components/ui/dialog";
import { InputGroup } from "~/components/ui/input-group";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import type { RouterOutputs } from "~/utils/api";
import {
  AddBindingForm,
  roleBadgeColor,
  scopeTypeLabel,
  SourceBadge,
} from "./GroupBindingInputRow";

type Group = RouterOutputs["group"]["listAll"][number];

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
  const [addMemberId, setAddMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [pendingName, setPendingName] = useState(group.name);
  const [committedName, setCommittedName] = useState(group.name);

  useEffect(() => {
    if (open) {
      setPendingName(group.name);
      setCommittedName(group.name);
    }
  }, [open, group.id, group.name]);

  const nameChanged = pendingName.trim() !== committedName && pendingName.trim() !== "";

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
    onSuccess: () => {
      void queryClient.group.getById.invalidate();
      void queryClient.group.listAll.invalidate();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  const renameGroup = api.group.rename.useMutation({
    onSuccess: (updated) => {
      void queryClient.group.listAll.invalidate();
      void queryClient.group.getById.invalidate();
      setPendingName(updated.name);
      setCommittedName(updated.name);
      toaster.create({ title: "Group renamed", type: "success" });
    },
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
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          setAddMemberId("");
          setMemberSearch("");
          setPendingName(group.name);
          onClose();
        }
      }}
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
                              removeBinding.mutate({ organizationId, bindingId: b.id })
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
                      <RandomColorAvatar name={m.name ?? m.email ?? "?"} size="xs" />
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
                    .map((m) => ({
                      label: `${m.user.name ?? m.user.email} (${m.user.email})`,
                      value: m.userId,
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
                  const availableItems = memberSearch
                    ? allAvailable.filter((m) =>
                        m.label.toLowerCase().includes(memberSearch.toLowerCase()),
                      )
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
                            <InputGroup
                              startElement={<Search size={14} />}
                              startOffset="2px"
                              width="full"
                            >
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
                          addMember.mutate({
                            organizationId,
                            groupId: group.id,
                            userId: addMemberId,
                          })
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
        {canManage && !detail.data?.scimSource && nameChanged && (
          <Dialog.Footer>
            <Button
              colorPalette="blue"
              loading={renameGroup.isPending}
              onClick={() =>
                renameGroup.mutate({
                  organizationId,
                  groupId: group.id,
                  name: pendingName.trim(),
                })
              }
            >
              Save
            </Button>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
