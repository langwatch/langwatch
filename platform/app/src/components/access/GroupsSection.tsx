import {
  Alert,
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { providerDisplayName } from "@ee/sso/logic/providerDisplayName";
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
import { SectionTitle } from "~/components/settings/kit/SettingRow";
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
 * The chip names the identity provider wherever it can: an administrator with
 * two connections needs to know WHICH one sent this, and the generic word
 * answers a question nobody asked. It falls back to that generic word only
 * when the stored source names a protocol rather than a product, because the
 * alternative there is printing "SCIM" at a customer.
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
  // NAME THE DIRECTORY WHERE WE CAN, NEVER THE PROTOCOL. The chip used to
  // render the stored source uppercased, which is right for "okta" and puts
  // the literal word "SCIM" on a customer's screen when the source is the
  // protocol instead of a product. The spec asks for a chip naming the
  // directory, so a vendor we can spell is named and everything else falls
  // back to what people carry for the same fact (`ProvenanceChip`).
  const source = group.scimSource
    ? (providerDisplayName(group.scimSource) ?? "Directory")
    : null;

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
            title={`Sent by ${source}. Who is in it is your identity provider's, what it grants is yours.`}
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
                  <Edit2 size={14} />
                  Edit
                </Menu.Item>
                <Menu.Item value="delete" color="red.fg" onClick={onDelete}>
                  <Trash2 size={14} />
                  Delete
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

  const deleteGroup = useDeleteGroup(setGroupToDelete);

  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: !!organizationId && isEnterprise },
  );

  if (isPlanLoading) return <Spinner size="sm" />;

  if (!isEnterprise) return <GroupsNeedEnterprise />;

  return (
    <>
      <VStack align="stretch" gap={6} width="full">
        {/* A HEADING, not bold text. It is the title of a section, so it
            belongs in the document's heading order — a reader moving by
            headings skipped this one entirely — and it wears the kit's
            SectionTitle, the same one every other tab of this page leads
            with. */}
        <SectionTitle
          title="Groups"
          hint="Assign access to many people at once. Who is in a group your identity provider sends is theirs; what it grants is yours."
        />

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

      <DeleteGroupDialog
        group={groupToDelete}
        organizationId={organizationId}
        deleteGroup={deleteGroup}
        onClose={() => setGroupToDelete(null)}
      />
    </>
  );
}

/**
 * Deleting a group, and clearing the confirmation that asked for it.
 *
 * The list is invalidated rather than patched: a group's disappearance changes
 * who is in what, and the rows beside it are drawn from the same read.
 */
function useDeleteGroup(
  setGroupToDelete: React.Dispatch<React.SetStateAction<Group | null>>,
) {
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

  return deleteGroup;
}

/**
 * What an organization without the plan sees instead of its groups.
 *
 * An upsell rather than an error: nothing is broken, and the control simply is
 * not part of what this organization bought.
 */
function GroupsNeedEnterprise() {
  return (
    <VStack gap={6} align="start" width="full">
      <Alert.Root status="info">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Enterprise feature</Alert.Title>
          <Alert.Description>
            Groups are available on Enterprise plans. Contact sales to upgrade.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
      <Box width="full">
        <ContactSalesBlock />
      </Box>
    </VStack>
  );
}

/**
 * The confirmation in front of deleting a group.
 *
 * A group the DIRECTORY sends is a different warning: deleting it locally does
 * not stop the identity provider re-sending it on the next sync, so the dialog
 * says so rather than implying the deletion is final.
 */
function DeleteGroupDialog({
  group,
  organizationId,
  deleteGroup,
  onClose,
}: {
  group: Group | null;
  organizationId: string;
  deleteGroup: ReturnType<typeof useDeleteGroup>;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={!!group}
      onOpenChange={(event) => {
        if (!event.open) onClose();
      }}
    >
      <Dialog.Content bg="bg" maxWidth="440px">
        <Dialog.Header>
          <Dialog.Title>Delete group</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body>
          <Text fontSize="sm">
            {group?.scimSource
              ? "Your identity provider will send this group again on its next sync. Delete it anyway?"
              : `Delete "${group?.name}" and all its access rules?`}
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            loading={deleteGroup.isPending}
            onClick={() =>
              group &&
              deleteGroup.mutate({
                organizationId,
                groupId: group.id,
              })
            }
          >
            Delete
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
