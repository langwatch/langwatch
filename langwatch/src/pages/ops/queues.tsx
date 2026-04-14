import { useEffect, useMemo, useState } from "react";
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
  VStack,
} from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Pause,
  Play,
  Search,
} from "lucide-react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useOpsSSE } from "~/hooks/useOpsSSE";
import { api } from "~/utils/api";
import type { GroupInfo, PipelineNode } from "~/server/app-layer/ops/types";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  isLoading: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text textStyle="sm">{description}</Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            size="sm"
            onClick={onConfirm}
            loading={isLoading}
          >
            Confirm
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function formatTimeAgo(ms: number | null): string {
  if (ms === null) return "—";
  const diff = Date.now() - ms;
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const isFuture = diff < 0;
  const prefix = isFuture ? "in " : "";
  const suffix = isFuture ? "" : " ago";
  if (seconds < 60) return `${prefix}${seconds}s${suffix}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${prefix}${minutes}m${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  return `${prefix}${days}d${suffix}`;
}

function isOverdue(ms: number | null): boolean {
  if (ms === null) return false;
  // Consider a group overdue if its oldest job is more than 5 minutes old
  return Date.now() - ms > 5 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Pipeline Tree (compact, collapsed by default)
// ---------------------------------------------------------------------------

function isNodePaused(
  node: PipelineNode,
  parentPath: string,
  pausedKeys: Set<string>,
): boolean {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (pausedKeys.has(path)) return true;
  if (parentPath) {
    const segments = parentPath.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const ancestor = segments.slice(0, i).join("/");
      if (pausedKeys.has(ancestor)) return true;
    }
  }
  return false;
}

function isNodeDirectlyPaused(
  nodePath: string,
  pausedKeys: Set<string>,
): boolean {
  return pausedKeys.has(nodePath);
}

function filterTree(
  nodes: PipelineNode[],
  query: string,
): PipelineNode[] | null {
  if (!query.trim()) return nodes;
  const lower = query.toLowerCase();

  function prune(node: PipelineNode): PipelineNode | null {
    if (node.name.toLowerCase().includes(lower)) return node;
    const filtered = node.children
      .map(prune)
      .filter((c): c is PipelineNode => c !== null);
    if (filtered.length > 0) return { ...node, children: filtered };
    return null;
  }

  const result = nodes
    .map(prune)
    .filter((n): n is PipelineNode => n !== null);
  return result.length > 0 ? result : null;
}

function PipelineTreeNode({
  node,
  parentPath,
  depth,
  pausedKeys,
  expandedPaths,
  onToggleExpand,
  onPause,
  onUnpause,
  canManage,
  queueNames,
}: {
  node: PipelineNode;
  parentPath: string;
  depth: number;
  pausedKeys: Set<string>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onPause: (key: string) => void;
  onUnpause: (key: string) => void;
  canManage: boolean;
  queueNames: string[];
}) {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPaths.has(path);
  const paused = isNodePaused(node, parentPath, pausedKeys);
  const directlyPaused = isNodeDirectlyPaused(path, pausedKeys);
  const isLeaf = !hasChildren;

  return (
    <>
      <HStack
        paddingY={1}
        paddingX={3}
        paddingLeft={`${depth * 20 + 12}px`}
        cursor={hasChildren ? "pointer" : "default"}
        _hover={{ bg: "bg.subtle" }}
        onClick={() => hasChildren && onToggleExpand(path)}
        borderBottom="1px solid"
        borderBottomColor="border"
        gap={2}
        opacity={paused ? 0.6 : 1}
      >
        <Box width="14px" flexShrink={0}>
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </Box>

        <Text
          textStyle="xs"
          fontWeight={depth === 0 ? "semibold" : "medium"}
          fontFamily={isLeaf ? "mono" : undefined}
          flex={1}
          color={paused ? "orange.500" : undefined}
        >
          {node.name}
        </Text>

        {paused && (
          <Badge size="xs" colorPalette="orange" variant="subtle">Paused</Badge>
        )}

        <HStack gap={1} flexShrink={0}>
          {node.pending > 0 && (
            <Badge size="xs" colorPalette="blue" variant="subtle">{node.pending}</Badge>
          )}
          {node.active > 0 && (
            <Badge size="xs" colorPalette="green" variant="subtle">{node.active}</Badge>
          )}
          {node.blocked > 0 && (
            <Badge size="xs" colorPalette="red" variant="subtle">{node.blocked}</Badge>
          )}
        </HStack>

        {canManage && (
          <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
            {directlyPaused ? (
              <Button variant="ghost" size="2xs" colorPalette="green" onClick={() => onUnpause(path)}>
                <Play size={10} />
              </Button>
            ) : !paused ? (
              <Button variant="ghost" size="2xs" colorPalette="orange" onClick={() => onPause(path)}>
                <Pause size={10} />
              </Button>
            ) : null}
          </Box>
        )}
      </HStack>

      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <PipelineTreeNode
            key={child.name}
            node={child}
            parentPath={path}
            depth={depth + 1}
            pausedKeys={pausedKeys}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
            onPause={onPause}
            onUnpause={onUnpause}
            canManage={canManage}
            queueNames={queueNames}
          />
        ))}
    </>
  );
}

function PipelineTreeCard({
  pipelineTree,
  pausedKeys,
  queueNames,
}: {
  pipelineTree: PipelineNode[];
  pausedKeys: string[];
  queueNames: string[];
}) {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform" || scope?.kind === "organization";
  const utils = api.useContext();
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const pausedKeySet = useMemo(() => new Set(pausedKeys), [pausedKeys]);
  const filteredTree = useMemo(() => filterTree(pipelineTree, filter), [pipelineTree, filter]);

  const pauseMutation = api.ops.pausePipeline.useMutation({
    onSuccess: () => { toaster.create({ title: "Pipeline paused", type: "success" }); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to pause", description: error.message, type: "error" }); },
  });
  const unpauseMutation = api.ops.unpausePipeline.useMutation({
    onSuccess: () => { toaster.create({ title: "Pipeline unpaused", type: "success" }); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to unpause", description: error.message, type: "error" }); },
  });

  function handleToggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  function handleExpandAll() {
    const all = new Set<string>();
    function walk(nodes: PipelineNode[], parentPath: string) {
      for (const node of nodes) {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        all.add(path);
        walk(node.children, path);
      }
    }
    walk(pipelineTree, "");
    setExpandedPaths(all);
  }

  const queueName = queueNames[0];
  function handlePause(key: string) { if (queueName) pauseMutation.mutate({ queueName, key }); }
  function handleUnpause(key: string) { if (queueName) unpauseMutation.mutate({ queueName, key }); }

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">Pipeline Tree</Text>
          <Spacer />
          {pipelineTree.length > 0 && (
            <>
              <Box position="relative" width="200px">
                <Box position="absolute" left={2.5} top="50%" transform="translateY(-50%)" zIndex={1}>
                  <Search size={11} color="var(--chakra-colors-fg-muted)" />
                </Box>
                <Input size="xs" placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} paddingLeft={7} />
              </Box>
              <Button variant="ghost" size="2xs" onClick={handleExpandAll}>Expand all</Button>
              <Button variant="ghost" size="2xs" onClick={() => setExpandedPaths(new Set())}>Collapse</Button>
            </>
          )}
        </HStack>

        {pipelineTree.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">No pipelines discovered yet.</Text>
          </Box>
        ) : filteredTree === null ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">No pipelines match &quot;{filter}&quot;</Text>
          </Box>
        ) : (
          filteredTree.map((node) => (
            <PipelineTreeNode
              key={node.name}
              node={node}
              parentPath=""
              depth={0}
              pausedKeys={pausedKeySet}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onPause={handlePause}
              onUnpause={handleUnpause}
              canManage={canManage}
              queueNames={queueNames}
            />
          ))
        )}
      </Card.Body>
    </Card.Root>
  );
}

// ---------------------------------------------------------------------------
// Groups card
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "ok" | "blocked" | "stale" | "active";

function matchesStatusFilter(g: GroupInfo, filter: StatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "ok": return !g.isBlocked && !g.isStaleBlock;
    case "blocked": return g.isBlocked && !g.isStaleBlock;
    case "stale": return g.isStaleBlock;
    case "active": return g.hasActiveJob && !g.isBlocked;
  }
}

function GroupDetailDialog({
  group,
  onClose,
}: {
  group: { queueName: string; groupId: string } | null;
  onClose: () => void;
}) {
  const detailQuery = api.ops.getGroupDetail.useQuery(
    { queueName: group?.queueName ?? "", groupId: group?.groupId ?? "" },
    { enabled: !!group },
  );
  const jobsQuery = api.ops.getGroupJobs.useQuery(
    { queueName: group?.queueName ?? "", groupId: group?.groupId ?? "", page: 1, pageSize: 20 },
    { enabled: !!group },
  );

  const detail = detailQuery.data;
  const jobs = jobsQuery.data;

  return (
    <Dialog.Root open={!!group} onOpenChange={(e) => !e.open && onClose()} size="lg">
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">{group?.groupId}</Text>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {detailQuery.isLoading ? (
            <Center paddingY={6}><Spinner size="sm" /></Center>
          ) : detail ? (
            <VStack align="stretch" gap={4}>
              {/* Status row */}
              <HStack gap={4} flexWrap="wrap">
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Status</Text>
                  {detail.isStaleBlock ? (
                    <Badge size="sm" colorPalette="orange" variant="subtle">Stale</Badge>
                  ) : detail.isBlocked ? (
                    <Badge size="sm" colorPalette="red" variant="subtle">Blocked</Badge>
                  ) : detail.hasActiveJob ? (
                    <Badge size="sm" colorPalette="green" variant="subtle">Active</Badge>
                  ) : (
                    <Badge size="sm" colorPalette="gray" variant="subtle">OK</Badge>
                  )}
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Pipeline</Text>
                  <Text textStyle="sm">{detail.pipelineName ?? "—"}</Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Pending</Text>
                  <Text textStyle="sm" fontFamily="mono">{detail.pendingJobs}</Text>
                </VStack>
                {(detail.retryCount ?? 0) > 0 && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Retries</Text>
                    <Text textStyle="sm" fontFamily="mono" color="orange.500">{detail.retryCount}</Text>
                  </VStack>
                )}
                {detail.activeJobId && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Active Job</Text>
                    <Text textStyle="xs" fontFamily="mono" color="green.500">{detail.activeJobId}</Text>
                  </VStack>
                )}
              </HStack>

              {/* Timestamps */}
              <HStack gap={4}>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Oldest Job</Text>
                  <Text textStyle="sm">{formatTimeAgo(detail.oldestJobMs)}</Text>
                </VStack>
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" color="fg.muted">Newest Job</Text>
                  <Text textStyle="sm">{formatTimeAgo(detail.newestJobMs)}</Text>
                </VStack>
                {detail.processingDurationMs != null && (
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" color="fg.muted">Processing</Text>
                    <Text textStyle="sm">{detail.processingDurationMs}ms</Text>
                  </VStack>
                )}
              </HStack>

              {/* Error info */}
              {detail.errorMessage && (
                <VStack align="stretch" gap={1}>
                  <Text textStyle="xs" color="fg.muted">Error</Text>
                  <Card.Root borderColor="red.500/20">
                    <Card.Body padding={3}>
                      <Text textStyle="xs" color="red.500" whiteSpace="pre-wrap" wordBreak="break-word">
                        {detail.errorMessage}
                      </Text>
                      {detail.errorStack && (
                        <Box marginTop={2} maxHeight="200px" overflow="auto" bg="bg.subtle" borderRadius="sm" padding={2}>
                          <Text textStyle="xs" fontFamily="mono" color="fg.muted" whiteSpace="pre" fontSize="10px">
                            {detail.errorStack}
                          </Text>
                        </Box>
                      )}
                    </Card.Body>
                  </Card.Root>
                </VStack>
              )}

              {/* Jobs list */}
              <VStack align="stretch" gap={1}>
                <Text textStyle="xs" color="fg.muted">
                  Jobs {jobs ? `(${jobs.total})` : ""}
                </Text>
                {jobsQuery.isLoading ? (
                  <Spinner size="xs" />
                ) : jobs && jobs.jobs.length > 0 ? (
                  <VStack align="stretch" gap={2}>
                    {jobs.jobs.map((job) => (
                      <Card.Root key={job.jobId} variant="outline">
                        <Card.Body padding={3}>
                          <HStack gap={3} marginBottom={job.data ? 2 : 0}>
                            <VStack align="start" gap={0}>
                              <Text textStyle="xs" color="fg.muted">Job ID</Text>
                              <Text textStyle="xs" fontFamily="mono" wordBreak="break-all">{job.jobId}</Text>
                            </VStack>
                            <VStack align="start" gap={0}>
                              <Text textStyle="xs" color="fg.muted">Score</Text>
                              <Text textStyle="xs" fontFamily="mono">{job.score}</Text>
                            </VStack>
                          </HStack>
                          {job.data && (
                            <Box bg="bg.subtle" borderRadius="sm" padding={2} maxHeight="200px" overflow="auto">
                              <Text as="pre" textStyle="xs" fontFamily="mono" whiteSpace="pre-wrap" wordBreak="break-word" fontSize="11px">
                                {JSON.stringify(job.data, null, 2)}
                              </Text>
                            </Box>
                          )}
                        </Card.Body>
                      </Card.Root>
                    ))}
                  </VStack>
                ) : (
                  <Text textStyle="xs" color="fg.muted">No jobs in queue.</Text>
                )}
              </VStack>
            </VStack>
          ) : null}
        </Dialog.Body>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function GroupsCard({ queueNames }: { queueNames: string[] }) {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform" || scope?.kind === "organization";
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
                          <Text textStyle="xs" color="fg.muted" truncate>{group.pipelineName ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          <Text textStyle="xs" fontFamily="mono">{group.pendingJobs}</Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {(group.retryCount ?? 0) > 0 ? (
                            <Text textStyle="xs" fontFamily="mono" color="orange.500">{group.retryCount}</Text>
                          ) : (
                            <Text textStyle="xs" fontFamily="mono" color="fg.muted">—</Text>
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

// ---------------------------------------------------------------------------
// Blocked card (only rendered when blocked > 0)
// ---------------------------------------------------------------------------

function BlockedCard({ queueNames }: { queueNames: string[] }) {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform" || scope?.kind === "organization";
  const utils = api.useContext();

  const blockedQuery = api.ops.getBlockedSummary.useQuery();
  const queuesQuery = api.ops.listQueues.useQuery();

  const [unblockAllTarget, setUnblockAllTarget] = useState<string | null>(null);
  const [drainTarget, setDrainTarget] = useState<{ queueName: string; groupId: string } | null>(null);
  const [moveToDlqTarget, setMoveToDlqTarget] = useState<string | null>(null);
  const [canaryQueueTarget, setCanaryQueueTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);

  const unblockAllMutation = api.ops.unblockAll.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Unblocked ${data.unblockedCount} groups`, type: "success" }); setUnblockAllTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Unblock failed", description: error.message, type: "error" }); },
  });
  const drainGroupMutation = api.ops.drainGroup.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Drained, removed ${data.jobsRemoved} jobs`, type: "success" }); setDrainTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Drain failed", description: error.message, type: "error" }); },
  });
  const moveAllToDlqMutation = api.ops.moveAllBlockedToDlq.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Moved ${data.movedCount} groups to DLQ`, type: "success" }); setMoveToDlqTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Move to DLQ failed", description: error.message, type: "error" }); },
  });
  const canaryUnblockMutation = api.ops.canaryUnblock.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Canary unblocked ${data.unblockedCount}`, type: "success" }); setCanaryQueueTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Canary failed", description: error.message, type: "error" }); },
  });

  const queuesWithBlocked = (queuesQuery.data ?? []).filter((q) => q.blockedGroupCount > 0);

  if (blockedQuery.isLoading) return null;
  if (!blockedQuery.data || blockedQuery.data.clusters.length === 0) return null;

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Text textStyle="sm" fontWeight="medium" color="red.500">
              Blocked — {blockedQuery.data.totalBlocked} groups, {blockedQuery.data.clusters.length} error patterns
            </Text>
            <Spacer />
            {canManage && (
              <HStack gap={1.5} flexWrap="wrap">
                {queuesWithBlocked.map((q) => (
                  <Button key={q.name} variant="outline" size="2xs" colorPalette="orange" onClick={() => setUnblockAllTarget(q.name)}>
                    Unblock All ({q.blockedGroupCount})
                  </Button>
                ))}
                {queuesWithBlocked.map((q) => (
                  <Button key={`dlq-${q.name}`} variant="outline" size="2xs" colorPalette="red" onClick={() => setMoveToDlqTarget(q.name)}>
                    → DLQ
                  </Button>
                ))}
                <HStack gap={1}>
                  <Text textStyle="xs" color="fg.muted">Canary:</Text>
                  <Input size="xs" type="number" value={canaryCount} onChange={(e) => setCanaryCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 5)))} width="50px" />
                  {queuesWithBlocked.map((q) => (
                    <Button key={`c-${q.name}`} variant="ghost" size="2xs" onClick={() => setCanaryQueueTarget(q.name)}>Go</Button>
                  ))}
                </HStack>
              </HStack>
            )}
          </HStack>

          <Table.ScrollArea>
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="60px" textAlign="end">Count</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                  <Table.ColumnHeader>Sample Groups</Table.ColumnHeader>
                  <Table.ColumnHeader width="60px">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {blockedQuery.data.clusters.map((cluster, i) => (
                  <Table.Row key={i}>
                    <Table.Cell textAlign="end">
                      <Text color="red.500" fontWeight="medium" textStyle="xs">{cluster.count}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" truncate maxWidth="300px" title={cluster.sampleMessage}>{cluster.sampleMessage}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted">{cluster.pipelineName ?? "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" fontFamily="mono" truncate maxWidth="160px">
                        {cluster.sampleGroupIds.slice(0, 2).join(", ")}
                        {cluster.sampleGroupIds.length > 2 ? ` +${cluster.sampleGroupIds.length - 2}` : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {cluster.sampleGroupIds[0] && (
                        <Button variant="outline" size="2xs" colorPalette="red" onClick={() => setDrainTarget({ queueName: cluster.queueName, groupId: cluster.sampleGroupIds[0]! })}>
                          Drain
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>

      <ConfirmDialog open={!!unblockAllTarget} onClose={() => setUnblockAllTarget(null)} onConfirm={() => { if (unblockAllTarget) unblockAllMutation.mutate({ queueName: unblockAllTarget }); }} title="Unblock All" description={`Unblock all blocked groups in "${unblockAllTarget}". They will retry immediately.`} isLoading={unblockAllMutation.isPending} />
      <ConfirmDialog open={!!drainTarget} onClose={() => setDrainTarget(null)} onConfirm={() => { if (drainTarget) drainGroupMutation.mutate(drainTarget); }} title="Drain Group" description={`Permanently remove all jobs from "${drainTarget?.groupId}". Cannot be undone.`} isLoading={drainGroupMutation.isPending} />
      <ConfirmDialog open={!!moveToDlqTarget} onClose={() => setMoveToDlqTarget(null)} onConfirm={() => { if (moveToDlqTarget) moveAllToDlqMutation.mutate({ queueName: moveToDlqTarget }); }} title="Move All to DLQ" description={`Move all blocked groups in "${moveToDlqTarget}" to DLQ. They can be replayed later.`} isLoading={moveAllToDlqMutation.isPending} />
      <ConfirmDialog open={!!canaryQueueTarget} onClose={() => setCanaryQueueTarget(null)} onConfirm={() => { if (canaryQueueTarget) canaryUnblockMutation.mutate({ queueName: canaryQueueTarget, count: canaryCount }); }} title="Canary Unblock" description={`Unblock ${canaryCount} random groups in "${canaryQueueTarget}" as a canary test.`} isLoading={canaryUnblockMutation.isPending} />
    </>
  );
}

// ---------------------------------------------------------------------------
// DLQ card (only rendered when dlq > 0)
// ---------------------------------------------------------------------------

function DlqCard({ queueNames }: { queueNames: string[] }) {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform" || scope?.kind === "organization";
  const utils = api.useContext();

  const dlqQuery = api.ops.listAllDlqGroups.useQuery(undefined, { refetchInterval: 10000 });

  const [replayTarget, setReplayTarget] = useState<{ queueName: string; groupId: string } | null>(null);
  const [replayAllTarget, setReplayAllTarget] = useState<string | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);

  const replayMutation = api.ops.replayFromDlq.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Replayed ${data.jobsReplayed} jobs`, type: "success" }); setReplayTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Replay failed", description: error.message, type: "error" }); },
  });
  const replayAllMutation = api.ops.replayAllFromDlq.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Replayed ${data.replayedCount} groups`, type: "success" }); setReplayAllTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Replay all failed", description: error.message, type: "error" }); },
  });
  const canaryRedriveMutation = api.ops.canaryRedrive.useMutation({
    onSuccess: (data) => { toaster.create({ title: `Canary redrove ${data.redrivenCount}`, type: "success" }); setCanaryTarget(null); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Canary failed", description: error.message, type: "error" }); },
  });

  const groups = dlqQuery.data ?? [];
  const dlqQueueNames = [...new Set(groups.map((g) => g.queueName))];

  if (dlqQuery.isLoading || groups.length === 0) return null;

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Text textStyle="sm" fontWeight="medium" color="orange.500">
              Dead Letter Queue — {groups.length} group{groups.length !== 1 ? "s" : ""}
            </Text>
            <Spacer />
            {canManage && (
              <HStack gap={1.5} flexWrap="wrap">
                {dlqQueueNames.map((qn) => {
                  const count = groups.filter((g) => g.queueName === qn).length;
                  const displayName = groups.find((g) => g.queueName === qn)?.queueDisplayName ?? qn;
                  return (
                    <Button key={qn} variant="outline" size="2xs" colorPalette="green" onClick={() => setReplayAllTarget(qn)}>
                      Replay All {displayName} ({count})
                    </Button>
                  );
                })}
                <HStack gap={1}>
                  <Text textStyle="xs" color="fg.muted">Canary:</Text>
                  <Input size="xs" type="number" value={canaryCount} onChange={(e) => setCanaryCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 5)))} width="50px" />
                  {dlqQueueNames.map((qn) => (
                    <Button key={`c-${qn}`} variant="ghost" size="2xs" onClick={() => setCanaryTarget(qn)}>Go</Button>
                  ))}
                </HStack>
              </HStack>
            )}
          </HStack>

          <Table.ScrollArea>
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Queue</Table.ColumnHeader>
                  <Table.ColumnHeader>Group ID</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end" width="50px">Jobs</Table.ColumnHeader>
                  {canManage && <Table.ColumnHeader width="70px">Actions</Table.ColumnHeader>}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {groups.map((group) => (
                  <Table.Row key={`${group.queueName}:${group.groupId}`}>
                    <Table.Cell><Badge size="xs" variant="subtle">{group.queueDisplayName}</Badge></Table.Cell>
                    <Table.Cell><Text textStyle="xs" fontFamily="mono" truncate maxWidth="160px">{group.groupId}</Text></Table.Cell>
                    <Table.Cell><Text textStyle="xs" color="fg.muted">{group.pipelineName ?? "—"}</Text></Table.Cell>
                    <Table.Cell><Text textStyle="xs" color="red.500" truncate maxWidth="220px" title={group.error ?? undefined}>{group.error ?? ""}</Text></Table.Cell>
                    <Table.Cell textAlign="end"><Text textStyle="xs">{group.jobCount}</Text></Table.Cell>
                    {canManage && (
                      <Table.Cell>
                        <Button variant="outline" size="2xs" colorPalette="green" onClick={() => setReplayTarget({ queueName: group.queueName, groupId: group.groupId })}>Replay</Button>
                      </Table.Cell>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </Card.Body>
      </Card.Root>

      <ConfirmDialog open={!!replayTarget} onClose={() => setReplayTarget(null)} onConfirm={() => { if (replayTarget) replayMutation.mutate(replayTarget); }} title="Replay from DLQ" description={`Move "${replayTarget?.groupId}" back to main queue for reprocessing.`} isLoading={replayMutation.isPending} />
      <ConfirmDialog open={!!replayAllTarget} onClose={() => setReplayAllTarget(null)} onConfirm={() => { if (replayAllTarget) replayAllMutation.mutate({ queueName: replayAllTarget }); }} title="Replay All from DLQ" description={`Move all DLQ groups in "${replayAllTarget}" back to main queue.`} isLoading={replayAllMutation.isPending} />
      <ConfirmDialog open={!!canaryTarget} onClose={() => setCanaryTarget(null)} onConfirm={() => { if (canaryTarget) canaryRedriveMutation.mutate({ queueName: canaryTarget, count: canaryCount }); }} title="Canary Redrive" description={`Replay ${canaryCount} random DLQ groups from "${canaryTarget}" as canary.`} isLoading={canaryRedriveMutation.isPending} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OpsQueuesPage() {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();

  useEffect(() => {
    if (!isLoading && !hasAccess) void router.push("/");
  }, [hasAccess, isLoading, router]);

  const { data: sseData } = useOpsSSE();
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: !sseData,
    refetchInterval: sseData ? false : 5000,
  });
  const data = sseData ?? snapshot.data ?? null;

  const queuesQuery = api.ops.listQueues.useQuery(undefined, { refetchInterval: 10000 });
  const queueNames = useMemo(() => (queuesQuery.data ?? []).map((q) => q.name), [queuesQuery.data]);

  if (isLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Pipelines &amp; Queues</PageLayout.Heading>
        <Spacer />
      </PageLayout.Header>
      <PageLayout.Container>
        <VStack align="stretch" gap={5}>
          {data ? (
            <PipelineTreeCard
              pipelineTree={data.pipelineTree}
              pausedKeys={data.pausedKeys}
              queueNames={queueNames}
            />
          ) : (
            <Card.Root>
              <Card.Body padding={0}>
                <HStack paddingX={4} paddingY={2.5}>
                  <Text textStyle="sm" fontWeight="medium">Pipeline Tree</Text>
                  <Spacer />
                  <Spinner size="xs" />
                </HStack>
              </Card.Body>
            </Card.Root>
          )}
          <BlockedCard queueNames={queueNames} />
          <DlqCard queueNames={queueNames} />
          <GroupsCard queueNames={queueNames} />
        </VStack>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
