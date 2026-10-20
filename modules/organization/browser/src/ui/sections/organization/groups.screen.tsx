import { Link } from "@langwatch/browser-host/link";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
/**
 * Groups an organization grants access through: the Directory's Groups tab. A
 * SCIM-synced group's deletion here only holds until the next sync.
 * Enterprise gates the FEATURE, not the PAGE — never a missing page.
 */
import { Dialog } from "@langwatch/design-system/dialog";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  chakra,
  Heading,
  HStack,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { Edit2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { RouterOutputs } from "../../../behavior/organization-api.ts";
import { api } from "../../../behavior/organization-api.ts";
import {
  useOrganizationToaster,
  useShowErrorToast,
} from "../../../behavior/organization-feedback.ts";
import { useActivePlan } from "../../../behavior/use-active-plan.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useOrganizationHost } from "../../../model/organization-host.ts";
import { CreateGroupDialog } from "../../../ui/sections/create-group-dialog.tsx";
import { GroupDetailDialog } from "../../../ui/sections/group-detail-dialog.tsx";
import {
  roleBadgeColor,
  SourceBadge,
  scopeTypeLabel,
} from "../../../ui/sections/group-grant-input-row.tsx";

type Group = RouterOutputs["group"]["listAll"][number];

export default function GroupsScreen() {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const { organization } = useOrganizationTeamProject();
  const host = useOrganizationHost();
  const { isEnterprise } = useActivePlan();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const queryClient = api.useUtils();

  const deleteGroup = api.group.delete.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group deleted", type: "success" });
      void queryClient.group.listAll.invalidate();
      void queryClient.organization.getDirectoryCounts.invalidate();
      setGroupToDelete(null);
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't delete the group" }),
  });

  const groups = api.group.listAll.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization && isEnterprise },
  );

  const canManage = host.hasPermission("organization:manage");

  if (!organization) return null;

  if (!isEnterprise) {
    return (
      <VStack gap={6} align="start" width="full">
        <UpgradeRequired
          feature="Groups"
          actions={
            <Button asChild colorPalette="orange" size="sm">
              <Link href="/settings/plans">Compare plans</Link>
            </Button>
          }
        />
      </VStack>
    );
  }

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <HStack justify="space-between" width="full">
          <VStack align="start" gap={1}>
            <Heading size="sm" as="h2">
              Groups
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Assign access to many people at once. SCIM-synced groups are managed by your identity
              provider.
            </Text>
          </VStack>
        </HStack>

        <Separator />

        {groups.isLoading && <SkeletonRows rows={4} />}

        {!groups.isLoading && (
          <Box width="full" data-testid="groups-list">
            <ListTable scroll="x" scrollLabel="Groups">
              <ListTable.Header>
                <ListTable.Row>
                  <ListTable.ColumnHeader>Group</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader width="120px">Source</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader align="end">Access</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader width="80px" align="end">
                    Members
                  </ListTable.ColumnHeader>
                  {canManage && <ListTable.ActionHeader />}
                </ListTable.Row>
              </ListTable.Header>
              <ListTable.Body>
                {(groups.data ?? []).map((g) => (
                  <ListTable.Row
                    key={g.id}
                    data-testid="group-row"
                    onActivate={() => setSelectedGroup(g)}
                  >
                    <ListTable.Cell>
                      <ListTable.RowAction onActivate={() => setSelectedGroup(g)}>
                        {g.name}
                      </ListTable.RowAction>
                    </ListTable.Cell>
                    <ListTable.Cell>
                      <SourceBadge scimSource={g.scimSource} />
                    </ListTable.Cell>
                    <ListTable.Cell>
                      <VStack gap={1} align="end">
                        {g.grants.map((b, i) => (
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
                        {g.grants.length === 0 && (
                          <Text fontSize="xs" color="fg.subtle" textAlign="right">
                            No access configured
                          </Text>
                        )}
                      </VStack>
                    </ListTable.Cell>
                    <ListTable.Cell align="end">
                      <Text fontSize="sm" color="fg.muted">
                        {g.memberCount}
                      </Text>
                    </ListTable.Cell>
                    {canManage && (
                      <ListTable.ActionCell>
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={`Actions for ${g.name}`}
                              data-testid="groups-row-actions"
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
                              color="red.fg"
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
                      </ListTable.ActionCell>
                    )}
                  </ListTable.Row>
                ))}
                {(groups.data ?? []).length === 0 && (
                  <ListTable.EmptyRow
                    columns={canManage ? 5 : 4}
                    state="empty"
                    title="No groups yet"
                    description="Groups assign access to many people at once."
                    next={[
                      {
                        kind: "docs",
                        label: "How directory groups work",
                        href: "https://langwatch.ai/docs/platform/scim-groups",
                      },
                    ]}
                  />
                )}
                {canManage && (
                  <ListTable.SpanRow columns={5}>
                    <chakra.button
                      type="button"
                      width="full"
                      textAlign="start"
                      cursor="pointer"
                      color="fg.muted"
                      paddingX={4}
                      paddingY={3}
                      _hover={{ bg: "bg.muted" }}
                      onClick={() => setCreating(true)}
                      data-testid="groups-add-manual"
                    >
                      <HStack gap={2}>
                        <Plus size={14} />
                        <Text textStyle="body">Add a group</Text>
                      </HStack>
                    </chakra.button>
                  </ListTable.SpanRow>
                )}
              </ListTable.Body>
            </ListTable>
          </Box>
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

      <Dialog
        open={!!groupToDelete}
        onClose={() => setGroupToDelete(null)}
        title="Delete group"
        primaryAction={{
          label: "Delete",
          onClick: () =>
            groupToDelete &&
            deleteGroup.mutate({
              organizationId: organization.id,
              groupId: groupToDelete.id,
            }),
          loading: deleteGroup.isPending,
          danger: true,
        }}
      >
        <Text fontSize="sm">
          {groupToDelete?.scimSource
            ? "This SCIM group will be re-created by your IdP on next sync. Delete anyway?"
            : `Delete "${groupToDelete?.name}" and all its access rules?`}
        </Text>
      </Dialog>
    </>
  );
}
