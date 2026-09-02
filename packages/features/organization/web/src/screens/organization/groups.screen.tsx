/**
 * The groups an organization grants access through, at `/settings/groups`.
 *
 * A GROUP IS A BAG OF PEOPLE WITH ACCESS RULES ON IT, so the table shows both:
 * who is in it, and what each of its bindings grants where. A SCIM-synced group
 * is owned by the customer's identity provider — deleting one here only holds
 * until the next sync, which is what the delete dialog says out loud.
 *
 * ENTERPRISE GATES THE FEATURE AND NOT THE PAGE. A reader below the plan gets
 * the page and a straight answer about what groups would do, because hiding a
 * paid capability makes it look missing rather than purchasable — the
 * audit-log family's ruling, applied again.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

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
import { Edit2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { CreateGroupDialog } from "../../ui/sections/create-group-dialog";
import {
  roleBadgeColor,
  SourceBadge,
  scopeTypeLabel,
} from "../../ui/blocks/group-binding-input-row";
import { GroupDetailDialog } from "../../ui/sections/group-detail-dialog";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { ContactSalesBlock } from "@langwatch/enterprise-billing-web";
import { useActivePlan } from "../../behavior/use-active-plan";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import type { RouterOutputs } from "../../behavior/organization-api";
import { api } from "../../behavior/organization-api";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback";

type Group = RouterOutputs["group"]["listAll"][number];

/** The grant the platform page asked for, unchanged. */
export const GROUPS_PAGE_PERMISSION = "organization:manage";

export default function GroupsScreen() {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { isEnterprise } = useActivePlan();
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
    onError: (e) =>
      showErrorToast({ error: e, fallbackTitle: "Couldn't delete the group" }),
  });

  const groups = api.group.listAll.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization && isEnterprise },
  );

  const canManage = hasPermission("organization:manage");

  if (!organization) return null;

  if (!isEnterprise) {
    return (
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
    );
  }

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <HStack justify="space-between" width="full">
          <VStack align="start" gap={1}>
            <Heading as="h2">Groups</Heading>
            <Text color="fg.muted" fontSize="sm">
              Assign access to many people at once. SCIM-synced groups are managed by your
              identity provider.
            </Text>
          </VStack>
        </HStack>

        <Separator />

        {groups.isLoading && <Spinner />}

        {!groups.isLoading && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0} overflowX="auto">
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Group</Table.ColumnHeader>
                    <Table.ColumnHeader width="120px">Source</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="right">Access</Table.ColumnHeader>
                    <Table.ColumnHeader width="80px" textAlign="right">
                      Members
                    </Table.ColumnHeader>
                    {canManage && <Table.ColumnHeader width="48px" />}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {(groups.data ?? []).map((g) => (
                    <Table.Row
                      key={g.id}
                      cursor="pointer"
                      onClick={() => setSelectedGroup(g)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedGroup(g);
                        }
                      }}
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setCreating(true);
                        }
                      }}
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
        onOpenChange={(e) => {
          if (!e.open) setGroupToDelete(null);
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
                ? "This SCIM group will be re-created by your IdP on next sync. Delete anyway?"
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
                  organizationId: organization.id,
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
