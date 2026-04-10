import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Separator,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { MoreVertical } from "react-feather";
import { useState } from "react";
import { CreateGroupDialog } from "~/components/settings/CreateGroupDialog";
import { GroupDetailDialog } from "~/components/settings/GroupDetailDialog";
import {
  roleBadgeColor,
  scopeTypeLabel,
  SourceBadge,
} from "~/components/settings/GroupBindingInputRow";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { ContactSalesBlock } from "../../components/subscription/ContactSalesBlock";
import SettingsLayout from "../../components/SettingsLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useActivePlan } from "../../hooks/useActivePlan";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { RouterOutputs } from "../../utils/api";

type Group = RouterOutputs["group"]["listAll"][number];

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
                        <Text fontSize="sm" color="fg.muted">{g.memberCount}</Text>
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
                                value="edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedGroup(g);
                                }}
                              >
                                <Box display="flex" alignItems="center" gap={2}>
                                  <Edit2 size={14} />
                                  Edit
                                </Box>
                              </Menu.Item>
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

      <Dialog.Root
        open={!!groupToDelete}
        onOpenChange={(e) => { if (!e.open) setGroupToDelete(null); }}
      >
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
