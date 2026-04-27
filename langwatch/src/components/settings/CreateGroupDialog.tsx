import {
  Badge,
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import { Dialog } from "~/components/ui/dialog";
import { InputGroup } from "~/components/ui/input-group";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import {
  BindingInputRow,
  roleBadgeColor,
  scopeTypeLabel,
  type PendingBinding,
} from "./GroupBindingInputRow";

export function CreateGroupDialog({
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
    .map((m) => ({
      label: `${m.user.name ?? m.user.email} (${m.user.email})`,
      value: m.userId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const availableMemberItems = memberSearch
    ? allAvailableMembers.filter((m) =>
        m.label.toLowerCase().includes(memberSearch.toLowerCase()),
      )
    : allAvailableMembers;
  const availableMemberCollection = createListCollection({ items: availableMemberItems });

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
                        <Text flex={1}>
                          {member?.user.name ?? member?.user.email ?? userId}
                        </Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="fg.muted"
                          aria-label={`Remove ${member?.user.name ?? member?.user.email ?? userId} from group`}
                          onClick={() =>
                            setPendingMemberIds((prev) => prev.filter((id) => id !== userId))
                          }
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
            loading={createGroup.isPending}
            onClick={() => void handleCreate()}
          >
            Create group
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
