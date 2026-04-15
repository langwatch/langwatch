import { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { GroupInfo } from "~/server/app-layer/ops/types";
import { toaster } from "~/components/ui/toaster";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { isOverdue, matchesStatusFilter } from "./pipelineUtils";
import { GroupDetailDialog } from "./GroupDetailDialog";
import type { StatusFilter } from "./types";

export function GroupsCard({ queueNames }: { queueNames: string[] }) {
  const { hasAccess: canManage } = useOpsPermission();
  const utils = api.useContext();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  // Use the first queue name for the groups query (most setups have a single queue)
  const primaryQueue = queueNames[0];
  const groupsQuery = api.ops.listGroups.useQuery(
    { queueName: primaryQueue ?? "", page: 1, pageSize: 200 },
    { refetchInterval: 10000, enabled: !!primaryQueue },
  );

  const allGroups = useMemo(() => {
    const groups: Array<GroupInfo & { queueName: string }> = [];
    if (groupsQuery.data && primaryQueue) {
      for (const g of groupsQuery.data.groups) {
        groups.push({ ...g, queueName: primaryQueue });
      }
    }
    return groups;
  }, [groupsQuery.data, primaryQueue]);

  const filteredGroups = useMemo(() => {
    let groups = allGroups;
    if (statusFilter !== "all") groups = groups.filter((g) => matchesStatusFilter(g, statusFilter));
    if (search.trim()) {
      const lower = search.toLowerCase();
      groups = groups.filter((g) =>
        g.groupId.toLowerCase().includes(lower) ||
        g.pipelineName?.toLowerCase().includes(lower) ||
        g.errorMessage?.toLowerCase().includes(lower),
      );
    }
    return groups;
  }, [allGroups, statusFilter, search]);

  const counts = useMemo(() => {
    let ok = 0, blocked = 0, stale = 0, active = 0;
    for (const g of allGroups) {
      if (g.isStaleBlock) stale++; else if (g.isBlocked) blocked++; else ok++;
      if (g.hasActiveJob && !g.isBlocked) active++;
    }
    return { all: allGroups.length, ok, blocked, stale, active };
  }, [allGroups]);

  const isLoading = !!primaryQueue && groupsQuery.isLoading;

  const [selectedGroup, setSelectedGroup] = useState<{ queueName: string; groupId: string } | null>(null);
  const [drainTarget, setDrainTarget] = useState<{ queueName: string; groupId: string } | null>(null);
  const drainGroupMutation = api.ops.drainGroup.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Drained, removed ${data.jobsRemoved} jobs`, type: "success" }); setDrainTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to drain", description: error.message, type: "error" }); },
  });
  const unblockMutation = api.ops.unblockGroup.useMutation({
    onSuccess: () => { toaster.create({ title: "Group unblocked", type: "success" }); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to unblock", description: error.message, type: "error" }); },
  });

  const statusButtons: Array<{ value: StatusFilter; label: string; count: number; color: string }> = [
    { value: "all", label: "All", count: counts.all, color: "gray" },
    { value: "ok", label: "OK", count: counts.ok, color: "green" },
    { value: "blocked", label: "Blocked", count: counts.blocked, color: "red" },
    { value: "stale", label: "Stale", count: counts.stale, color: "orange" },
    { value: "active", label: "Active", count: counts.active, color: "blue" },
  ];

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Text textStyle="sm" fontWeight="medium">Groups</Text>
            <Spacer />
            {allGroups.length > 0 && (
              <>
                <HStack gap={1}>
                  {statusButtons.map((btn) => (
                    <Button
                      key={btn.value}
                      size="2xs"
                      variant={statusFilter === btn.value ? "solid" : "ghost"}
                      colorPalette={btn.color}
                      onClick={() => setStatusFilter(btn.value)}
                    >
                      {btn.label} {btn.count > 0 ? `(${btn.count})` : ""}
                    </Button>
                  ))}
                </HStack>
                <Box position="relative" width="200px">
                  <Box position="absolute" left={2.5} top="50%" transform="translateY(-50%)" zIndex={1}>
                    <Search size={11} color="var(--chakra-colors-fg-muted)" />
                  </Box>
                  <Input size="xs" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} paddingLeft={7} />
                </Box>
              </>
            )}
          </HStack>

          {isLoading ? (
            <Center paddingY={6}><Spinner size="sm" /></Center>
          ) : allGroups.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">No groups — queues are idle.</Text>
            </Box>
          ) : filteredGroups.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">No groups match current filters.</Text>
            </Box>
          ) : (
            <>
              <Table.ScrollArea>
                <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Group ID</Table.ColumnHeader>
                      <Table.ColumnHeader width="140px">Pipeline</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end" width="50px">Pend.</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end" width="45px">Retry</Table.ColumnHeader>
                      <Table.ColumnHeader width="75px">Oldest</Table.ColumnHeader>
                      <Table.ColumnHeader width="65px">Status</Table.ColumnHeader>
                      {canManage && <Table.ColumnHeader width="100px">Actions</Table.ColumnHeader>}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {filteredGroups.slice(0, 100).map((group) => {
                      const overdue = !group.isBlocked && isOverdue(group.oldestJobMs);
                      return (
                      <Table.Row
                        key={`${group.queueName}:${group.groupId}`}
                        cursor="pointer"
                        _hover={{ bg: "bg.subtle" }}
                        onClick={() => setSelectedGroup({ queueName: group.queueName, groupId: group.groupId })}
                      >
                        <Table.Cell>
                          <Text textStyle="xs" fontFamily="mono" truncate title={group.groupId}>{group.groupId}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text textStyle="xs" color="fg.muted" truncate>{group.pipelineName ?? "\u2014"}</Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          <Text textStyle="xs" fontFamily="mono">{group.pendingJobs}</Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {(group.retryCount ?? 0) > 0 ? (
                            <Text textStyle="xs" fontFamily="mono" color="orange.500">{group.retryCount}</Text>
                          ) : (
                            <Text textStyle="xs" fontFamily="mono" color="fg.muted">{"\u2014"}</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Text textStyle="xs" color={overdue ? "orange.500" : "fg.muted"} fontWeight={overdue ? "medium" : undefined}>
                            {formatTimeAgo(group.oldestJobMs)}{overdue ? " ⚠" : ""}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          {group.isStaleBlock ? (
                            <Badge size="xs" colorPalette="orange" variant="subtle">Stale</Badge>
                          ) : group.isBlocked ? (
                            <Badge size="xs" colorPalette="red" variant="subtle">Blocked</Badge>
                          ) : group.hasActiveJob ? (
                            <Badge size="xs" colorPalette="green" variant="subtle">Active</Badge>
                          ) : (
                            <Badge size="xs" colorPalette="gray" variant="subtle">OK</Badge>
                          )}
                        </Table.Cell>
                        {canManage && (
                          <Table.Cell onClick={(e) => e.stopPropagation()}>
                            <HStack gap={1}>
                              {group.isBlocked && (
                                <Button variant="outline" size="2xs" colorPalette="green" onClick={() => unblockMutation.mutate({ queueName: group.queueName, groupId: group.groupId })} loading={unblockMutation.isPending}>
                                  Retry
                                </Button>
                              )}
                              <Button variant="outline" size="2xs" colorPalette="red" onClick={() => setDrainTarget({ queueName: group.queueName, groupId: group.groupId })}>
                                Drain
                              </Button>
                            </HStack>
                          </Table.Cell>
                        )}
                      </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </Table.ScrollArea>
              {filteredGroups.length > 100 && (
                <Box padding={3} borderTop="1px solid" borderTopColor="border">
                  <Text textStyle="xs" color="fg.muted" textAlign="center">Showing 100 of {filteredGroups.length}</Text>
                </Box>
              )}
            </>
          )}
        </Card.Body>
      </Card.Root>

      <GroupDetailDialog group={selectedGroup} onClose={() => setSelectedGroup(null)} />

      <ConfirmDialog
        open={!!drainTarget}
        onClose={() => setDrainTarget(null)}
        onConfirm={() => { if (drainTarget) drainGroupMutation.mutate(drainTarget); }}
        title="Drain Group"
        description={`Permanently remove all jobs from "${drainTarget?.groupId}". Cannot be undone.`}
        isLoading={drainGroupMutation.isPending}
      />
    </>
  );
}
