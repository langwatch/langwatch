import { useState } from "react";
import {
  Box,
  Button,
  Card,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
} from "@chakra-ui/react";
import { toaster } from "~/components/ui/toaster";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { VirtualizedTableRows } from "~/components/ops/shared/VirtualizedTableRows";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";

const BLOCKED_VIEWPORT_HEIGHT = 360;
const BLOCKED_ROW_HEIGHT = 36;

export function BlockedCard({ queueNames }: { queueNames: string[] }) {
  const { hasAccess } = useOpsPermission();
  const utils = api.useContext();

  const blockedQuery = api.ops.getBlockedSummary.useQuery();
  const queuesQuery = api.ops.listQueues.useQuery();

  const [unblockAllTarget, setUnblockAllTarget] = useState<string | null>(null);
  const [drainTarget, setDrainTarget] = useState<{ queueName: string; groupId: string } | null>(null);
  const [moveToDlqTarget, setMoveToDlqTarget] = useState<string | null>(null);
  const [canaryQueueTarget, setCanaryQueueTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(
    null,
  );

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

  const clusters = blockedQuery.data.clusters;

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border" gap={2} flexWrap="wrap">
            <Text textStyle="sm" fontWeight="medium" color="red.500">
              Blocked — {blockedQuery.data.totalBlocked} groups, {clusters.length} error patterns
            </Text>
            <Spacer />
            {hasAccess && (
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

          <Box
            ref={setScrollContainer}
            maxHeight={`${BLOCKED_VIEWPORT_HEIGHT}px`}
            overflowY="auto"
          >
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header position="sticky" top={0} zIndex={1} bg="bg">
                <Table.Row>
                  <Table.ColumnHeader width="60px" textAlign="end">Count</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                  <Table.ColumnHeader>Sample Groups</Table.ColumnHeader>
                  <Table.ColumnHeader width="60px">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <VirtualizedTableRows
                  count={clusters.length}
                  rowHeight={BLOCKED_ROW_HEIGHT}
                  columnCount={5}
                  scrollContainer={scrollContainer}
                  getItemKey={(i) => {
                    const c = clusters[i]!;
                    return `${c.queueName}::${c.normalizedMessage}`;
                  }}
                  renderRow={(i) => {
                    const cluster = clusters[i]!;
                    const rowKey = `${cluster.queueName}::${cluster.normalizedMessage}`;
                    return (
                      <Table.Row key={rowKey}>
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
                    );
                  }}
                />
              </Table.Body>
            </Table.Root>
          </Box>
        </Card.Body>
      </Card.Root>

      <ConfirmDialog open={!!unblockAllTarget} onClose={() => setUnblockAllTarget(null)} onConfirm={() => { if (unblockAllTarget) unblockAllMutation.mutate({ queueName: unblockAllTarget }); }} title="Unblock All" description={`Unblock all blocked groups in "${unblockAllTarget}". They will retry immediately.`} isLoading={unblockAllMutation.isPending} />
      <ConfirmDialog open={!!drainTarget} onClose={() => setDrainTarget(null)} onConfirm={() => { if (drainTarget) drainGroupMutation.mutate(drainTarget); }} title="Drain Group" description={`Permanently remove all jobs from "${drainTarget?.groupId}". Cannot be undone.`} isLoading={drainGroupMutation.isPending} />
      <ConfirmDialog open={!!moveToDlqTarget} onClose={() => setMoveToDlqTarget(null)} onConfirm={() => { if (moveToDlqTarget) moveAllToDlqMutation.mutate({ queueName: moveToDlqTarget }); }} title="Move All to DLQ" description={`Move all blocked groups in "${moveToDlqTarget}" to DLQ. They can be replayed later.`} isLoading={moveAllToDlqMutation.isPending} />
      <ConfirmDialog open={!!canaryQueueTarget} onClose={() => setCanaryQueueTarget(null)} onConfirm={() => { if (canaryQueueTarget) canaryUnblockMutation.mutate({ queueName: canaryQueueTarget, count: canaryCount }); }} title="Canary Unblock" description={`Unblock ${canaryCount} random groups in "${canaryQueueTarget}" as a canary test.`} isLoading={canaryUnblockMutation.isPending} />
    </>
  );
}
