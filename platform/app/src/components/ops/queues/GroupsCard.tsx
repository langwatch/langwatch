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
import { MoreVertical, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { VirtualizedTableRows } from "~/components/ops/shared/VirtualizedTableRows";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import type { GroupInfo } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import {
  grafanaGroupLogsUrl,
  grafanaGroupTracesUrl,
} from "~/utils/grafanaLinks";
import { GroupStateBadge } from "./GroupStateBadge";
import {
  classifyGroup,
  describeNextRun,
  isOverdue,
  matchesStatusFilter,
  sortGroupsBySeverity,
} from "./pipelineUtils";
import type { StatusFilter } from "./types";

const GROUPS_VIEWPORT_HEIGHT = 480;
const GROUPS_ROW_HEIGHT = 36;

export function GroupsCard({ queueNames }: { queueNames: string[] }) {
  const { hasAccess } = useOpsPermission();
  const utils = api.useUtils();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Classification compares dispatch-eligibility scores against "now"; pinning
  // now to the fetch instant keeps the rows stable between refreshes instead of
  // reclassifying on every unrelated render.
  const now = groupsQuery.dataUpdatedAt || Date.now();

  const filteredGroups = useMemo(() => {
    let groups = allGroups;
    if (statusFilter !== "all")
      groups = groups.filter((g) => matchesStatusFilter(g, statusFilter, now));
    if (search.trim()) {
      const lower = search.toLowerCase();
      groups = groups.filter(
        (g) =>
          g.groupId.toLowerCase().includes(lower) ||
          g.pipelineName?.toLowerCase().includes(lower) ||
          g.errorMessage?.toLowerCase().includes(lower),
      );
    }
    return sortGroupsBySeverity(groups, now);
  }, [allGroups, statusFilter, search, now]);

  const counts = useMemo(() => {
    const countMatching = (filter: StatusFilter) =>
      allGroups.filter((g) => matchesStatusFilter(g, filter, now)).length;
    return {
      all: allGroups.length,
      ok: countMatching("ok"),
      blocked: countMatching("blocked"),
      stale: countMatching("stale"),
      active: countMatching("active"),
      retrying: countMatching("retrying"),
    };
  }, [allGroups, now]);

  // Filter changes shrink the visible row count without re-mounting the
  // scroll container, so the virtualizer's total height drops while
  // scrollTop holds its old value — leaving blank space below the rows
  // until the user scrolls. Snap back to the top on every filter change.
  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [statusFilter, search]);

  const isLoading = !!primaryQueue && groupsQuery.isLoading;

  const { openDrawer } = useDrawer();
  // One config fetch serves every row's Grafana links; the pure builders in
  // ~/utils/grafanaLinks turn it into per-group hrefs client-side.
  const grafanaQuery = api.ops.getGrafanaLinkConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const grafana = grafanaQuery.data ?? null;

  const [drainTarget, setDrainTarget] = useState<{
    queueName: string;
    groupId: string;
  } | null>(null);
  const [drainTenantTarget, setDrainTenantTarget] = useState<string | null>(
    null,
  );
  const drainGroupMutation = api.ops.drainGroup.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Drained, removed ${data.jobsRemoved} jobs`,
        type: "success",
      });
      setDrainTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't drain the group" }),
  });
  const unblockMutation = api.ops.unblockGroup.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Group unblocked", type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't unblock the group" }),
  });
  const [dlqTarget, setDlqTarget] = useState<{
    queueName: string;
    groupId: string;
  } | null>(null);
  const moveToDlqMutation = api.ops.moveToDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Moved ${data.jobsMoved} jobs to the dead-letter queue`,
        type: "success",
      });
      setDlqTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't move the group to the dead-letter queue",
      }),
  });
  const copyGroupId = (groupId: string) => {
    navigator.clipboard.writeText(groupId).then(
      () => toaster.create({ title: "Group ID copied", type: "success" }),
      () =>
        toaster.create({ title: "Couldn't copy the group ID", type: "error" }),
    );
  };

  // Tenant-scoped controls. Activated when the search box is a single
  // tenant prefix (no slash) — typically `project_…`. Reuses the same
  // search input the operator was already typing for filter scope.
  const tenantScope = useMemo(() => {
    const s = search.trim();
    if (!s || s.includes("/") || s.includes(" ")) return null;
    if (!s.startsWith("project_")) return null;
    return s;
  }, [search]);

  const pausedTenantsQuery = api.ops.listPausedTenants.useQuery(
    { queueName: primaryQueue ?? "" },
    { enabled: !!primaryQueue, refetchInterval: 10000 },
  );
  const isTenantPaused = !!(
    tenantScope && pausedTenantsQuery.data?.includes(tenantScope)
  );

  const pauseTenantMutation = api.ops.pauseTenant.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({
        title: `Paused tenant ${vars.tenantId}`,
        type: "success",
      });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't pause the tenant" }),
  });
  const unpauseTenantMutation = api.ops.unpauseTenant.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({
        title: `Unpaused tenant ${vars.tenantId}`,
        type: "success",
      });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't unpause the tenant" }),
  });
  const drainTenantMutation = api.ops.drainTenant.useMutation({
    onSuccess: (data, vars) => {
      toaster.create({
        title: `Drained ${data.groupsDrained} groups (${data.jobsDrained} jobs) for ${vars.tenantId}`,
        type: "success",
      });
      setDrainTenantTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't drain the tenant's groups",
      });
      setDrainTenantTarget(null);
    },
  });

  const statusButtons: Array<{
    value: StatusFilter;
    label: string;
    count: number;
    color: string;
  }> = [
    { value: "all", label: "All", count: counts.all, color: "gray" },
    { value: "ok", label: "OK", count: counts.ok, color: "green" },
    { value: "blocked", label: "Blocked", count: counts.blocked, color: "red" },
    {
      value: "retrying",
      label: "Retrying",
      count: counts.retrying,
      color: "orange",
    },
    { value: "stale", label: "Stale", count: counts.stale, color: "orange" },
    { value: "active", label: "Active", count: counts.active, color: "blue" },
  ];

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          {/* Paused-tenants banner: always visible when at least one tenant is paused so
              operators don't accidentally assume a tenant's silence means it's healthy. */}
          {hasAccess &&
            pausedTenantsQuery.data &&
            pausedTenantsQuery.data.length > 0 && (
              <HStack
                paddingX={4}
                paddingY={2}
                borderBottom="1px solid"
                borderBottomColor="border"
                bg="yellow.subtle"
                gap={2}
                flexWrap="wrap"
              >
                <Text textStyle="xs" fontWeight="medium">
                  Paused tenants:
                </Text>
                {pausedTenantsQuery.data.map((tid) => (
                  <HStack key={tid} gap={1}>
                    <Badge
                      size="xs"
                      colorPalette="yellow"
                      variant="solid"
                      fontFamily="mono"
                    >
                      {tid}
                    </Badge>
                    <Button
                      size="2xs"
                      variant="outline"
                      colorPalette="green"
                      onClick={() =>
                        primaryQueue &&
                        unpauseTenantMutation.mutate({
                          queueName: primaryQueue,
                          tenantId: tid,
                        })
                      }
                      loading={
                        unpauseTenantMutation.isPending &&
                        unpauseTenantMutation.variables?.tenantId === tid
                      }
                    >
                      Unpause
                    </Button>
                  </HStack>
                ))}
              </HStack>
            )}

          <HStack
            paddingX={4}
            paddingY={2.5}
            borderBottom="1px solid"
            borderBottomColor="border"
            gap={2}
            flexWrap="wrap"
          >
            <Text textStyle="sm" fontWeight="medium">
              Groups
            </Text>
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
                  <Box
                    position="absolute"
                    left={2.5}
                    top="50%"
                    transform="translateY(-50%)"
                    zIndex={1}
                  >
                    <Search size={11} color="var(--chakra-colors-fg-muted)" />
                  </Box>
                  <Input
                    size="xs"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    paddingLeft={7}
                  />
                </Box>
              </>
            )}
          </HStack>

          {/* Tenant-scoped action bar: visible when the operator searches for an
              exact tenant id (e.g. project_W_7kPya...). Lets them pause/unpause
              ALL processing for that tenant or bulk-drain every group. Added
              post-2026-05-11 incident — clicking 500K Drain buttons by hand
              was the actual blocker that day. */}
          {hasAccess && tenantScope && primaryQueue && (
            <HStack
              paddingX={4}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
              gap={2}
              flexWrap="wrap"
              bg="bg.subtle"
            >
              <Text textStyle="xs" fontWeight="medium">
                Tenant actions:
              </Text>
              <Badge size="xs" variant="subtle" fontFamily="mono">
                {tenantScope}
              </Badge>
              {isTenantPaused ? (
                <Button
                  size="2xs"
                  variant="outline"
                  colorPalette="green"
                  onClick={() => {
                    pauseTenantMutation.reset();
                    unpauseTenantMutation.mutate({
                      queueName: primaryQueue,
                      tenantId: tenantScope,
                    });
                  }}
                  loading={unpauseTenantMutation.isPending}
                >
                  Unpause Tenant
                </Button>
              ) : (
                <Button
                  size="2xs"
                  variant="outline"
                  colorPalette="yellow"
                  onClick={() => {
                    unpauseTenantMutation.reset();
                    pauseTenantMutation.mutate({
                      queueName: primaryQueue,
                      tenantId: tenantScope,
                    });
                  }}
                  loading={pauseTenantMutation.isPending}
                >
                  Pause Tenant
                </Button>
              )}
              <Button
                size="2xs"
                variant="outline"
                colorPalette="red"
                onClick={() => setDrainTenantTarget(tenantScope)}
              >
                Drain All Tenant Groups
              </Button>
            </HStack>
          )}

          {isLoading ? (
            <Center paddingY={6}>
              <Spinner size="sm" />
            </Center>
          ) : allGroups.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                No groups — queues are idle.
              </Text>
            </Box>
          ) : filteredGroups.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                No groups match current filters.
              </Text>
            </Box>
          ) : (
            <Box
              ref={scrollContainerRef}
              maxHeight={`${GROUPS_VIEWPORT_HEIGHT}px`}
              overflowY="auto"
            >
              <Table.Root
                size="sm"
                variant="line"
                css={{ "& tr:last-child td": { borderBottom: "none" } }}
              >
                <Table.Header
                  position="sticky"
                  top={0}
                  zIndex={1}
                  bg="bg.panel"
                >
                  <Table.Row>
                    <Table.ColumnHeader>Group ID</Table.ColumnHeader>
                    <Table.ColumnHeader width="140px">
                      Pipeline
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end" width="60px">
                      Pending
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end" width="65px">
                      Attempts
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="80px">
                      Next run
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="85px">
                      Oldest wait
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="70px">Status</Table.ColumnHeader>
                    {hasAccess && (
                      <Table.ColumnHeader width="44px">
                        <Text srOnly>Actions</Text>
                      </Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <VirtualizedTableRows
                    count={filteredGroups.length}
                    rowHeight={GROUPS_ROW_HEIGHT}
                    columnCount={hasAccess ? 8 : 7}
                    scrollContainerRef={scrollContainerRef}
                    getItemKey={(i) => {
                      const g = filteredGroups[i]!;
                      return `${g.queueName}:${g.groupId}`;
                    }}
                    renderRow={(i) => {
                      const group = filteredGroups[i]!;
                      const c = classifyGroup(group, now);
                      const overdue =
                        !group.isBlocked && isOverdue(group.oldestJobMs);
                      // The tint answers "what is wrong RIGHT NOW" at a glance:
                      // red for groups an operator must act on, orange for
                      // groups still failing on their own.
                      const tint =
                        c.state === "blocked" || c.state === "stale"
                          ? "red.subtle"
                          : c.isFailing
                            ? "orange.subtle"
                            : undefined;
                      return (
                        <Table.Row
                          key={`${group.queueName}:${group.groupId}`}
                          cursor="pointer"
                          bg={tint}
                          _hover={{ bg: tint ?? "bg.subtle" }}
                          onClick={() =>
                            openDrawer("opsGroupDetail", {
                              queueName: group.queueName,
                              groupId: group.groupId,
                            })
                          }
                        >
                          <Table.Cell>
                            <Text
                              textStyle="xs"
                              fontFamily="mono"
                              truncate
                              title={group.groupId}
                            >
                              {group.groupId}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text textStyle="xs" color="fg.muted" truncate>
                              {group.pipelineName ?? "—"}
                            </Text>
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            <Text textStyle="xs" fontFamily="mono">
                              {group.pendingJobs}
                            </Text>
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            <Text
                              textStyle="xs"
                              fontFamily="mono"
                              color={
                                c.attempt > 0 ? "orange.solid" : "fg.muted"
                              }
                            >
                              {c.attempt > 0 ? c.attempt : "—"}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text
                              textStyle="xs"
                              color={
                                c.state === "retrying"
                                  ? "orange.solid"
                                  : "fg.muted"
                              }
                            >
                              {describeNextRun(c, now)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text
                              textStyle="xs"
                              color={overdue ? "orange.solid" : "fg.muted"}
                              fontWeight={overdue ? "medium" : undefined}
                            >
                              {formatTimeAgo(group.oldestJobMs)}
                              {overdue ? " ⚠" : ""}
                            </Text>
                          </Table.Cell>
                          <Table.Cell
                            title={
                              c.isFailing
                                ? (group.errorMessage ?? undefined)
                                : undefined
                            }
                          >
                            <GroupStateBadge c={c} />
                          </Table.Cell>
                          {hasAccess && (
                            <Table.Cell onClick={(e) => e.stopPropagation()}>
                              <Menu.Root>
                                <Menu.Trigger asChild>
                                  <Button
                                    size="2xs"
                                    variant="ghost"
                                    aria-label={`Actions for ${group.groupId}`}
                                  >
                                    <MoreVertical size={14} />
                                  </Button>
                                </Menu.Trigger>
                                <Menu.Content>
                                  {(c.state === "blocked" ||
                                    c.state === "stale") && (
                                    <Menu.Item
                                      value="retry"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        unblockMutation.mutate({
                                          queueName: group.queueName,
                                          groupId: group.groupId,
                                        });
                                      }}
                                    >
                                      Retry now
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    value="copy-id"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copyGroupId(group.groupId);
                                    }}
                                  >
                                    Copy group ID
                                  </Menu.Item>
                                  {grafana && (
                                    <Menu.Item value="grafana-traces" asChild>
                                      <a
                                        href={
                                          grafanaGroupTracesUrl(
                                            group.groupId,
                                            grafana,
                                          ) ?? undefined
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        View traces in Grafana
                                      </a>
                                    </Menu.Item>
                                  )}
                                  {grafana && (
                                    <Menu.Item value="grafana-logs" asChild>
                                      <a
                                        href={
                                          grafanaGroupLogsUrl(
                                            group.groupId,
                                            grafana,
                                          ) ?? undefined
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        View logs in Grafana
                                      </a>
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    value="move-to-dlq"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDlqTarget({
                                        queueName: group.queueName,
                                        groupId: group.groupId,
                                      });
                                    }}
                                  >
                                    Move to dead-letter queue
                                  </Menu.Item>
                                  <Menu.Item
                                    value="drain"
                                    color="red.solid"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDrainTarget({
                                        queueName: group.queueName,
                                        groupId: group.groupId,
                                      });
                                    }}
                                  >
                                    Drain
                                  </Menu.Item>
                                </Menu.Content>
                              </Menu.Root>
                            </Table.Cell>
                          )}
                        </Table.Row>
                      );
                    }}
                  />
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      <ConfirmDialog
        open={!!drainTarget}
        onClose={() => setDrainTarget(null)}
        onConfirm={() => {
          if (drainTarget) drainGroupMutation.mutate(drainTarget);
        }}
        title="Drain Group"
        description={`Permanently remove all jobs from "${drainTarget?.groupId}". Cannot be undone.`}
        isLoading={drainGroupMutation.isPending}
      />

      <ConfirmDialog
        open={!!dlqTarget}
        onClose={() => setDlqTarget(null)}
        onConfirm={() => {
          if (dlqTarget) moveToDlqMutation.mutate(dlqTarget);
        }}
        title="Move Group to Dead-Letter Queue"
        description={`Move all jobs from "${dlqTarget?.groupId}" to the dead-letter queue. They stop processing until replayed from the Dead Letter Queue card.`}
        isLoading={moveToDlqMutation.isPending}
      />

      <ConfirmDialog
        open={!!drainTenantTarget}
        onClose={() => setDrainTenantTarget(null)}
        onConfirm={() => {
          if (drainTenantTarget && primaryQueue) {
            drainTenantMutation.mutate({
              queueName: primaryQueue,
              tenantId: drainTenantTarget,
            });
          }
        }}
        title="Drain All Tenant Groups"
        description={`Permanently remove ALL pending groups for tenant "${drainTenantTarget}" across every pipeline. Cannot be undone. The event log in ClickHouse is preserved; you can replay later if needed.`}
        isLoading={drainTenantMutation.isPending}
      />
    </>
  );
}
