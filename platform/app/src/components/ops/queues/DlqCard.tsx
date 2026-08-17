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
import { useMemo, useRef, useState } from "react";
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

/** What a pending bulk or single act covers — named fully in the confirm. */
interface PendingDlqAction {
  kind: "redrive" | "discard";
  queueName: string;
  queueDisplayName: string;
  groupIds: string[];
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

  const [filterText, setFilterText] = useState("");
  const [pending, setPending] = useState<PendingDlqAction | null>(null);
  const [canaryTarget, setCanaryTarget] = useState<string | null>(null);
  const [canaryCount, setCanaryCount] = useState(5);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Both the row action and the per-queue bulk go through the explicit-id
  // endpoints: one verb, one audit shape, and the confirmation covers exactly
  // the ids that were shown when the operator clicked
  // (specs/ops/dead-letter-recovery.feature).
  const redriveMutation = api.ops.redriveManyFromDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Redrove ${data.redrivenCount} ${
          data.redrivenCount === 1 ? "group" : "groups"
        } (${data.jobsRedriven} jobs)`,
        type: "success",
      });
      setPending(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't redrive the groups" }),
  });
  const discardMutation = api.ops.discardManyFromDlq.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Discarded ${data.discardedCount} ${
          data.discardedCount === 1 ? "group" : "groups"
        } (${data.jobsDiscarded} jobs)`,
        type: "success",
      });
      setPending(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't discard the groups" }),
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
  // The filter narrows what is SHOWN, and the bulk actions act on exactly
  // that — group id, pipeline, or error, matched case-insensitively.
  const shownGroups = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter(
      (g) =>
        g.groupId.toLowerCase().includes(needle) ||
        (g.pipelineName ?? "").toLowerCase().includes(needle) ||
        (g.error ?? "").toLowerCase().includes(needle),
    );
  }, [groups, filterText]);
  const dlqQueueNames = [...new Set(shownGroups.map((g) => g.queueName))];
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

  const bulkFor = (
    kind: "redrive" | "discard",
    queueName: string,
  ): PendingDlqAction => {
    const inQueue = shownGroups.filter((g) => g.queueName === queueName);
    return {
      kind,
      queueName,
      queueDisplayName: inQueue[0]?.queueDisplayName ?? queueName,
      groupIds: inQueue.map((g) => g.groupId),
    };
  };

  const confirmPending = () => {
    if (!pending) return;
    const input = { queueName: pending.queueName, groupIds: pending.groupIds };
    if (pending.kind === "redrive") redriveMutation.mutate(input);
    else discardMutation.mutate(input);
  };

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
                Dead Letter Queue —{" "}
                {filterText.trim()
                  ? `${shownGroups.length} of ${groups.length}`
                  : groups.length}{" "}
                group{groups.length !== 1 ? "s" : ""}
              </Text>
            )}
            {groups.length > 0 && (
              <Input
                size="xs"
                width="220px"
                placeholder="Filter by group, pipeline, or error"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                data-testid="dlq-filter"
              />
            )}
            <Spacer />
            {hasAccess && (
              <HStack gap={1.5} flexWrap="wrap">
                {dlqQueueNames.map((qn) => {
                  const shown = shownGroups.filter((g) => g.queueName === qn);
                  const displayName = shown[0]?.queueDisplayName ?? qn;
                  return (
                    <HStack key={qn} gap={1}>
                      <Button
                        variant="outline"
                        size="2xs"
                        colorPalette="green"
                        data-testid={`dlq-redrive-shown-${qn}`}
                        onClick={() => setPending(bulkFor("redrive", qn))}
                      >
                        Redrive shown {displayName} ({shown.length})
                      </Button>
                      <Button
                        variant="outline"
                        size="2xs"
                        colorPalette="red"
                        data-testid={`dlq-discard-shown-${qn}`}
                        onClick={() => setPending(bulkFor("discard", qn))}
                      >
                        Discard shown ({shown.length})
                      </Button>
                    </HStack>
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
                    <Table.ColumnHeader width="130px">
                      Actions
                    </Table.ColumnHeader>
                  )}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <VirtualizedTableRows
                  count={shownGroups.length}
                  rowHeight={DLQ_ROW_HEIGHT}
                  columnCount={hasAccess ? 6 : 5}
                  scrollContainerRef={scrollContainerRef}
                  getItemKey={(i) => {
                    const g = shownGroups[i]!;
                    return `${g.queueName}:${g.groupId}`;
                  }}
                  renderRow={(i) => {
                    const group = shownGroups[i]!;
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
                            <HStack gap={1}>
                              <Button
                                variant="outline"
                                size="2xs"
                                colorPalette="green"
                                onClick={() =>
                                  setPending({
                                    kind: "redrive",
                                    queueName: group.queueName,
                                    queueDisplayName: group.queueDisplayName,
                                    groupIds: [group.groupId],
                                  })
                                }
                              >
                                Redrive
                              </Button>
                              <Button
                                variant="outline"
                                size="2xs"
                                colorPalette="red"
                                onClick={() =>
                                  setPending({
                                    kind: "discard",
                                    queueName: group.queueName,
                                    queueDisplayName: group.queueDisplayName,
                                    groupIds: [group.groupId],
                                  })
                                }
                              >
                                Discard
                              </Button>
                            </HStack>
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
        open={pending?.kind === "redrive"}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        title="Redrive from the dead-letter queue"
        description={
          pending?.groupIds.length === 1
            ? `Return "${pending.groupIds[0]}" in "${pending.queueDisplayName}" to the main queue for reprocessing.`
            : `Return ${pending?.groupIds.length} shown groups in "${pending?.queueDisplayName}" to the main queue for reprocessing.`
        }
        isLoading={redriveMutation.isPending}
      />
      <ConfirmDialog
        open={pending?.kind === "discard"}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        title="Discard from the dead-letter queue"
        description={
          pending?.groupIds.length === 1
            ? `Mark "${pending.groupIds[0]}" in "${pending.queueDisplayName}" as never to be run. The act is recorded in the audit trail with the group's last error; the jobs will not run.`
            : `Mark ${pending?.groupIds.length} shown groups in "${pending?.queueDisplayName}" as never to be run. The act is recorded in the audit trail with each group's last error; the jobs will not run.`
        }
        isLoading={discardMutation.isPending}
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
        description={`Redrive ${canaryCount} random dead-letter groups from "${canaryTarget}" as a canary.`}
        isLoading={canaryRedriveMutation.isPending}
      />
    </>
  );
}
