import {
  Alert,
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  IdentityChip,
  IdentityRow,
  IdentityRowList,
} from "~/components/access/IdentityRow";
import { RoleAssignmentList } from "~/components/access/roleAssignments";
import { CreateGroupDialog } from "~/components/settings/CreateGroupDialog";
import { GroupDetailDialog } from "~/components/settings/GroupDetailDialog";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { ContactSalesBlock } from "~/components/subscription/ContactSalesBlock";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useActivePlan } from "~/hooks/useActivePlan";
import type { RouterOutputs } from "~/utils/api";
import { api } from "~/utils/api";

type Group = RouterOutputs["group"]["listAll"][number];

/**
 * One group, whoever made it.
 *
 * The chip names the identity provider rather than saying "Directory": an
 * administrator with two connections needs to know WHICH one sent this, and
 * the generic word answers a question nobody asked.
 */
function GroupRow({
  group,
  canManage,
  onOpen,
  onDelete,
}: {
  group: Group;
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const source = group.scimSource?.toUpperCase() ?? null;

  return (
    <IdentityRow
      id={group.id}
      name={group.name}
      address={null}
      data-testid="group-row"
      onOpen={onOpen}
      badges={
        source ? (
          <IdentityChip
            label={source}
            title={`Sent by ${source}. Who is in it is your identity provider's; what it grants is yours.`}
            data-testid="group-directory-chip"
          />
        ) : null
      }
      chips={
        <Text fontSize="xs" color="fg.muted">
          {group.memberCount === 1 ? "1 person" : `${group.memberCount} people`}
        </Text>
      }
      trailing={
        <HStack gap={3}>
          <RoleAssignmentList assignments={group.bindings} />
          {canManage && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Actions for ${group.name}`}
                >
                  <MoreVertical size={16} />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item value="edit" onClick={onOpen}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Edit2 size={14} />
                    Edit
                  </Box>
                </Menu.Item>
                <Menu.Item value="delete" color="red.500" onClick={onDelete}>
                  <Box display="flex" alignItems="center" gap={2}>
                    <Trash2 size={14} />
                    Delete
                  </Box>
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>
      }
    />
  );
}

/**
 * Every group in the organization, on the page that reports on the directory
 * that sends half of them.
 *
 * ONE LIST, NOT TWO. The groups an identity provider sends and the ones an
 * administrator made by hand were on separate screens, and the question
 * people actually arrive with spans both: did the group I mapped land, and
 * does it grant my people anything. A directory group carries a chip saying
 * whose it is; otherwise a group is a group, and what it GRANTS is the
 * organization's either way.
 *
 * Read-only where the directory owns it: membership belongs to the identity
 * provider and would be undone on the next push, so nothing here offers to
 * change it. The roles it carries are still the organization's, and the row
 * says so.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function GroupsSection({
  organizationId,
  canManage,
}: {
  organizationId: string;
  /** `organization:manage`. Without it the list is read-only. */
  canManage: boolean;
}) {
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const queryClient = api.useUtils();

  const deleteGroup = api.group.delete.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group deleted", type: "success" });
      void queryClient.group.listAll.invalidate();
      setGroupToDelete(null);
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't delete the group" }),
  });

  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: !!organizationId && isEnterprise },
  );

  if (isPlanLoading) return <Spinner size="sm" />;

  if (!isEnterprise) {
    return (
      <VStack gap={6} align="start" width="full">
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Enterprise feature</Alert.Title>
            <Alert.Description>
              Groups are available on Enterprise plans. Contact sales to
              upgrade.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
        <Box width="full">
          <ContactSalesBlock />
        </Box>
      </VStack>
    );
  }

  return (
    <>
      <VStack align="stretch" gap={4} width="full">
        <VStack align="start" gap={1}>
          <Text fontSize="md" fontWeight={600}>
            Groups
          </Text>
          <Text color="fg.muted" fontSize="sm">
            Assign access to many people at once. Who is in a group your
            identity provider sends is theirs; what it grants is yours.
          </Text>
        </VStack>

        {groups.isLoading && <Spinner size="sm" />}

        {groups.isError && (
          <SectionErrorNotice
            error={groups.error}
            fallbackTitle="Couldn't load your groups"
          />
        )}

        {!groups.isLoading && !groups.isError && (
          <VStack align="stretch" gap={3} width="full">
            <IdentityRowList
              data-testid="groups-list"
              empty="No group has been created yet."
            >
              {(groups.data ?? []).map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  canManage={canManage}
                  onOpen={() => setSelectedGroup(group)}
                  onDelete={() => setGroupToDelete(group)}
                />
              ))}
            </IdentityRowList>
            {canManage && (
              <HStack>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreating(true)}
                >
                  <Plus size={14} />
                  Add a group
                </Button>
              </HStack>
            )}
          </VStack>
        )}
      </VStack>

      {selectedGroup && (
        <GroupDetailDialog
          group={selectedGroup}
          organizationId={organizationId}
          canManage={canManage}
          open={!!selectedGroup}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      <CreateGroupDialog
        organizationId={organizationId}
        open={creating}
        onClose={() => setCreating(false)}
      />

      <Dialog.Root
        open={!!groupToDelete}
        onOpenChange={(event) => {
          if (!event.open) setGroupToDelete(null);
        }}
      >
        <Dialog.Content bg="bg" maxWidth="440px">
          <Dialog.Header>
            <Dialog.Title>Delete group</Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body>
            <Text fontSize="sm">
              {groupToDelete?.scimSource
                ? "Your identity provider will send this group again on its next sync. Delete it anyway?"
                : `Delete "${groupToDelete?.name}" and all its access rules?`}
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setGroupToDelete(null)}>
              Cancel
            </Button>
            <Button
              colorPalette="red"
              loading={deleteGroup.isPending}
              onClick={() =>
                groupToDelete &&
                deleteGroup.mutate({
                  organizationId,
                  groupId: groupToDelete.id,
                })
              }
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
