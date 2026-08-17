import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
} from "@chakra-ui/react";
import { useRef, useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { VirtualizedTableRows } from "~/components/ops/shared/VirtualizedTableRows";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";

const DLQ_VIEWPORT_HEIGHT = 360;
const DLQ_ROW_HEIGHT = 36;

/**
 * Process-manager intents that retired, under the same heading as the queue's
 * dead letters.
 *
 * Two mechanisms, one question: an operator asking "what has stopped?" should
 * not have to know that a GroupQueue job and a process-manager intent retire
 * through different machinery. They still redrive from their own surfaces,
 * because those actions genuinely differ — so this states the problem and
 * links, rather than offering a control that would mean two things.
 */
function ProcessOutboxDeadRow({
  byProcess,
  total,
  hasQueueGroups,
}: {
  byProcess: Array<{ processName: string; count: number }>;
  total: number;
  hasQueueGroups: boolean;
}) {
  if (total === 0) return null;
  return (
    <HStack
      paddingX={4}
      paddingY={2.5}
      gap={2}
      flexWrap="wrap"
      borderBottom={hasQueueGroups ? "1px solid" : undefined}
      borderBottomColor="border"
    >
      <Text textStyle="sm" fontWeight="medium" color="red.500">
        Process outbox — {total} dead message{total !== 1 ? "s" : ""}
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {byProcess
          .slice(0, 3)
          .map((r) => `${r.processName} (${r.count})`)
          .join(", ")}
        {byProcess.length > 3 ? `, +${byProcess.length - 3} more` : ""}
      </Text>
      <Spacer />
      <Button size="2xs" variant="outline" asChild>
        <Link href="/ops/event-sourcing/dead-letters">Inspect</Link>
      </Button>
    </HStack>
  );
}

export function DlqCard({ queueNames }: { queueNames: string[] }) {
  const { hasAccess } = useOpsPermission();
  const utils = api.useUtils();

  const dlqQuery = api.ops.listAllDlqGroups.useQuery(undefined, {
    refetchInterval: 10000,
  });
  /** Process-manager intents that retired. Different mechanism from a DLQ
   *  group, same question for the reader: what has permanently stopped. */
  const processDeadQuery = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [replayTarget, setReplayTarget] = useState<{
    queueName: string;
    groupId: string;
  } | null>(null);
  const [replayAllTarget, setReplayAllTarget] = useState<string | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const replayMutation = api.ops.replayFromDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Replayed ${data.jobsReplayed} jobs`,
        type: "success",
      });
      setReplayTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't replay the group" }),
  });
  const replayAllMutation = api.ops.replayAllFromDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Replayed ${data.replayedCount} groups`,
        type: "success",
      });
      setReplayAllTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't replay the groups" }),
  });
  const canaryRedriveMutation = api.ops.canaryRedrive.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Canary redrove ${data.redrivenCount}`,
        type: "success",
      });
      setCanaryTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't run the canary redrive",
      }),
  });

  const groups = dlqQuery.data ?? [];
  const dlqQueueNames = [...new Set(groups.map((g) => g.queueName))];
  const processDead = processDeadQuery.data ?? [];
  const processDeadTotal = processDead.reduce((sum, r) => sum + r.count, 0);

  // Two mechanisms, one heading: an operator asking "what has stopped?" should
  // not have to know that a GroupQueue job and a process-manager intent retire
  // through different machinery. They still redrive from their own surfaces,
  // because the actions genuinely differ.
  // Both sources gate the render. Without the process-dead query in here the
  // card mounts on the queue answer alone and then flips a red row in a
  // moment later, which on an ops surface reads as a new incident rather than
  // as the same page finishing loading.
  if (
    dlqQuery.isLoading ||
    processDeadQuery.isLoading ||
    (groups.length === 0 && processDeadTotal === 0)
  ) {
    return null;
  }

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack
            paddingX={4}
            paddingY={2.5}
            borderBottom="1px solid"
            borderBottomColor="border"
            gap={2}
            flexWrap="wrap"
          >
            {/* The card now renders for either source, so the queue heading
                stands down when the queue itself is clean rather than
                printing "0 groups" above a red process-outbox count. */}
            {groups.length > 0 && (
              <Text textStyle="sm" fontWeight="medium" color="orange.500">
                Dead Letter Queue — {groups.length} group
                {groups.length !== 1 ? "s" : ""}
              </Text>
            )}
            <Spacer />
            {hasAccess && (
              <HStack gap={1.5} flexWrap="wrap">
                {dlqQueueNames.map((qn) => {
                  const count = groups.filter((g) => g.queueName === qn).length;
                  const displayName =
                    groups.find((g) => g.queueName === qn)?.queueDisplayName ??
                    qn;
                  return (
                    <Button
                      key={qn}
                      variant="outline"
                      size="2xs"
                      colorPalette="green"
                      onClick={() => setReplayAllTarget(qn)}
                    >
                      Replay All {displayName} ({count})
                    </Button>
                  );
                })}
                <HStack gap={1}>
                  <Text textStyle="xs" color="fg.muted">
                    Canary:
                  </Text>
                  <Input
                    size="xs"
                    type="number"
                    value={canaryCount}
                    onChange={(e) =>
                      setCanaryCount(
                        Math.max(
                          1,
                          Math.min(100, parseInt(e.target.value) || 5),
                        ),
                      )
                    }
                    width="50px"
                  />
                  {dlqQueueNames.map((qn) => (
                    <Button
                      key={`c-${qn}`}
                      variant="ghost"
                      size="2xs"
                      onClick={() => setCanaryTarget(qn)}
                    >
                      Go
                    </Button>
                  ))}
                </HStack>
              </HStack>
            )}
          </HStack>

          <ProcessOutboxDeadRow
            byProcess={processDead}
            total={processDeadTotal}
            hasQueueGroups={groups.length > 0}
          />

          <Box
            ref={scrollContainerRef}
            maxHeight={`${DLQ_VIEWPORT_HEIGHT}px`}
            overflowY="auto"
            hidden={groups.length === 0}
          >
            <Table.Root
              size="sm"
              variant="line"
              css={{ "& tr:last-child td": { borderBottom: "none" } }}
            >
              <Table.Header position="sticky" top={0} zIndex={1} bg="bg.panel">
                <Table.Row>
                  <Table.ColumnHeader>Queue</Table.ColumnHeader>
                  <Table.ColumnHeader>Group ID</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end" width="50px">
                    Jobs
                  </Table.ColumnHeader>
                  {hasAccess && (
                    <Table.ColumnHeader width="70px">
                      Actions
                    </Table.ColumnHeader>
                  )}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <VirtualizedTableRows
                  count={groups.length}
                  rowHeight={DLQ_ROW_HEIGHT}
                  columnCount={hasAccess ? 6 : 5}
                  scrollContainerRef={scrollContainerRef}
                  getItemKey={(i) => {
                    const g = groups[i]!;
                    return `${g.queueName}:${g.groupId}`;
                  }}
                  renderRow={(i) => {
                    const group = groups[i]!;
                    return (
                      <Table.Row key={`${group.queueName}:${group.groupId}`}>
                        <Table.Cell>
                          <Badge size="xs" variant="subtle">
                            {group.queueDisplayName}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Text
                            textStyle="xs"
                            fontFamily="mono"
                            truncate
                            maxWidth="160px"
                          >
                            {group.groupId}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text textStyle="xs" color="fg.muted">
                            {group.pipelineName ?? "—"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text
                            textStyle="xs"
                            color="red.500"
                            truncate
                            maxWidth="220px"
                            title={group.error ?? undefined}
                          >
                            {group.error ?? ""}
                          </Text>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          <Text textStyle="xs">{group.jobCount}</Text>
                        </Table.Cell>
                        {hasAccess && (
                          <Table.Cell>
                            <Button
                              variant="outline"
                              size="2xs"
                              colorPalette="green"
                              onClick={() =>
                                setReplayTarget({
                                  queueName: group.queueName,
                                  groupId: group.groupId,
                                })
                              }
                            >
                              Replay
                            </Button>
                          </Table.Cell>
                        )}
                      </Table.Row>
                    );
                  }}
                />
              </Table.Body>
            </Table.Root>
          </Box>
        </Card.Body>
      </Card.Root>

      <ConfirmDialog
        open={!!replayTarget}
        onClose={() => setReplayTarget(null)}
        onConfirm={() => {
          if (replayTarget) replayMutation.mutate(replayTarget);
        }}
        title="Replay from DLQ"
        description={`Move "${replayTarget?.groupId}" back to main queue for reprocessing.`}
        isLoading={replayMutation.isPending}
      />
      <ConfirmDialog
        open={!!replayAllTarget}
        onClose={() => setReplayAllTarget(null)}
        onConfirm={() => {
          if (replayAllTarget)
            replayAllMutation.mutate({ queueName: replayAllTarget });
        }}
        title="Replay All from DLQ"
        description={`Move all DLQ groups in "${replayAllTarget}" back to main queue.`}
        isLoading={replayAllMutation.isPending}
      />
      <ConfirmDialog
        open={!!canaryTarget}
        onClose={() => setCanaryTarget(null)}
        onConfirm={() => {
          if (canaryTarget)
            canaryRedriveMutation.mutate({
              queueName: canaryTarget,
              count: canaryCount,
            });
        }}
        title="Canary Redrive"
        description={`Replay ${canaryCount} random DLQ groups from "${canaryTarget}" as canary.`}
        isLoading={canaryRedriveMutation.isPending}
      />
    </>
  );
}
