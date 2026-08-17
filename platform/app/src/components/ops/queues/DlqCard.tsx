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
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { type PendingDlqAction, useDlqActions } from "./useDlqActions";

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

/** One shown DLQ group, as the card reads it. */
type ShownDlqGroup = {
  queueName: string;
  queueDisplayName: string;
  groupId: string;
};

/** Everything one table row renders. */
type DlqRowGroup = ShownDlqGroup & {
  pipelineName: string | null;
  error: string | null;
  jobCount: number;
};

/**
 * Narrow the list to what the operator typed — group id, pipeline, or error,
 * matched case-insensitively. What this returns IS what the bulk actions act
 * on, so the confirmation and the act cover the same groups.
 */
function filterDlqGroups<T extends DlqRowGroup>(groups: T[], filter: string) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter(
    (g) =>
      g.groupId.toLowerCase().includes(needle) ||
      (g.pipelineName ?? "").toLowerCase().includes(needle) ||
      (g.error ?? "").toLowerCase().includes(needle),
  );
}

/** The pending act for a whole queue's shown groups. */
function bulkActionFor(
  kind: "redrive" | "discard",
  queueName: string,
  shownGroups: ShownDlqGroup[],
): PendingDlqAction {
  const inQueue = shownGroups.filter((g) => g.queueName === queueName);
  return {
    kind,
    queueName,
    queueDisplayName: inQueue[0]?.queueDisplayName ?? queueName,
    groupIds: inQueue.map((g) => g.groupId),
  };
}

/**
 * The manage-gated controls: per-queue bulk acts over the SHOWN groups, and
 * the canary. Counts come from the filtered set, so each button states the
 * blast radius it will actually apply.
 */
function DlqToolbar({
  queueNames,
  shownGroups,
  canaryCount,
  onCanaryCountChange,
  onBulk,
  onCanary,
}: {
  queueNames: string[];
  shownGroups: ShownDlqGroup[];
  canaryCount: number;
  onCanaryCountChange: (count: number) => void;
  onBulk: (kind: "redrive" | "discard", queueName: string) => void;
  onCanary: (queueName: string) => void;
}) {
  return (
    <HStack gap={1.5} flexWrap="wrap">
      {queueNames.map((qn) => {
        const shown = shownGroups.filter((g) => g.queueName === qn);
        const displayName = shown[0]?.queueDisplayName ?? qn;
        return (
          <HStack key={qn} gap={1}>
            <Button
              variant="outline"
              size="2xs"
              colorPalette="green"
              data-testid={`dlq-redrive-shown-${qn}`}
              onClick={() => onBulk("redrive", qn)}
            >
              Redrive shown {displayName} ({shown.length})
            </Button>
            <Button
              variant="outline"
              size="2xs"
              colorPalette="red"
              data-testid={`dlq-discard-shown-${qn}`}
              onClick={() => onBulk("discard", qn)}
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
            onCanaryCountChange(
              Math.max(1, Math.min(100, parseInt(e.target.value) || 5)),
            )
          }
          width="50px"
        />
        {queueNames.map((qn) => (
          <Button
            key={`c-${qn}`}
            variant="ghost"
            size="2xs"
            onClick={() => onCanary(qn)}
          >
            Go
          </Button>
        ))}
      </HStack>
    </HStack>
  );
}

/** One dead-lettered group, with its per-row recovery verbs. */
export function DlqRow({
  group,
  canManage,
  onAct,
}: {
  group: DlqRowGroup;
  canManage: boolean;
  onAct: (kind: "redrive" | "discard", group: DlqRowGroup) => void;
}) {
  return (
    <Table.Row>
      <Table.Cell>
        <Badge size="xs" variant="subtle">
          {group.queueDisplayName}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono" truncate maxWidth="160px">
          {group.groupId}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {group.pipelineName ?? "\u2014"}
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
      {canManage && (
        <Table.Cell>
          <HStack gap={1}>
            <Button
              variant="outline"
              size="2xs"
              colorPalette="green"
              onClick={() => onAct("redrive", group)}
            >
              Redrive
            </Button>
            <Button
              variant="outline"
              size="2xs"
              colorPalette="red"
              onClick={() => onAct("discard", group)}
            >
              Discard
            </Button>
          </HStack>
        </Table.Cell>
      )}
    </Table.Row>
  );
}

export function DlqCard({ queueNames }: { queueNames: string[] }) {
  const { hasAccess } = useOpsPermission();
  const dlqQuery = api.ops.listAllDlqGroups.useQuery(undefined, {
    refetchInterval: 10000,
  });
  /** Process-manager intents that retired. Different mechanism from a DLQ
   *  group, same question for the reader: what has permanently stopped. */
  const processDeadQuery = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const [filterText, setFilterText] = useState("");
  const [canaryCount, setCanaryCount] = useState(5);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const actions = useDlqActions();

  const groups = dlqQuery.data ?? [];
  const shownGroups = useMemo(
    () => filterDlqGroups(groups, filterText),
    [groups, filterText],
  );
  const processDead = processDeadQuery.data ?? [];
  const processDeadTotal = processDead.reduce((sum, r) => sum + r.count, 0);
  const stillLoading = dlqQuery.isLoading || processDeadQuery.isLoading;

  // Two mechanisms, one heading: an operator asking "what has stopped?" should
  // not have to know that a GroupQueue job and a process-manager intent retire
  // through different machinery. They still redrive from their own surfaces,
  // because the actions genuinely differ.
  // Both sources gate the render. Without the process-dead query in here the
  // card mounts on the queue answer alone and then flips a red row in a
  // moment later, which on an ops surface reads as a new incident rather than
  // as the same page finishing loading.
  if (stillLoading || (groups.length === 0 && processDeadTotal === 0)) {
    return null;
  }

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <DlqCardHeader
            groupCount={groups.length}
            shownCount={shownGroups.length}
            filterText={filterText}
            onFilterChange={setFilterText}
            canManage={hasAccess}
            shownGroups={shownGroups}
            canaryCount={canaryCount}
            onCanaryCountChange={setCanaryCount}
            onBulk={(kind, queueName) =>
              actions.setPending(bulkActionFor(kind, queueName, shownGroups))
            }
            onCanary={actions.setCanaryTarget}
          />

          <ProcessOutboxDeadRow
            byProcess={processDead}
            total={processDeadTotal}
            hasQueueGroups={groups.length > 0}
          />

          <DlqTable
            shownGroups={shownGroups}
            hidden={groups.length === 0}
            canManage={hasAccess}
            scrollContainerRef={scrollContainerRef}
            onAct={(kind, group) =>
              actions.setPending({
                kind,
                queueName: group.queueName,
                queueDisplayName: group.queueDisplayName,
                groupIds: [group.groupId],
              })
            }
          />
        </Card.Body>
      </Card.Root>

      <DlqConfirms actions={actions} canaryCount={canaryCount} />
    </>
  );
}

/** Heading, filter, and the manage-gated controls, on one row. */
function DlqCardHeader({
  groupCount,
  shownCount,
  filterText,
  onFilterChange,
  canManage,
  shownGroups,
  canaryCount,
  onCanaryCountChange,
  onBulk,
  onCanary,
}: {
  groupCount: number;
  shownCount: number;
  filterText: string;
  onFilterChange: (value: string) => void;
  canManage: boolean;
  shownGroups: DlqRowGroup[];
  canaryCount: number;
  onCanaryCountChange: (count: number) => void;
  onBulk: (kind: "redrive" | "discard", queueName: string) => void;
  onCanary: (queueName: string) => void;
}) {
  const filtering = filterText.trim().length > 0;
  const queueNames = [...new Set(shownGroups.map((g) => g.queueName))];
  return (
    <HStack
      paddingX={4}
      paddingY={2.5}
      borderBottom="1px solid"
      borderBottomColor="border"
      gap={2}
      flexWrap="wrap"
    >
      {/* The card renders for either source, so the queue heading stands down
          when the queue itself is clean rather than printing "0 groups" above
          a red process-outbox count. */}
      {groupCount > 0 && (
        <>
          <Text textStyle="sm" fontWeight="medium" color="orange.500">
            Dead Letter Queue — {filtering ? `${shownCount} of ` : ""}
            {groupCount} group{groupCount !== 1 ? "s" : ""}
          </Text>
          <Input
            size="xs"
            width="220px"
            placeholder="Filter by group, pipeline, or error"
            value={filterText}
            onChange={(e) => onFilterChange(e.target.value)}
            data-testid="dlq-filter"
          />
        </>
      )}
      <Spacer />
      {canManage && (
        <DlqToolbar
          queueNames={queueNames}
          shownGroups={shownGroups}
          canaryCount={canaryCount}
          onCanaryCountChange={onCanaryCountChange}
          onBulk={onBulk}
          onCanary={onCanary}
        />
      )}
    </HStack>
  );
}

/** The dead-lettered groups themselves, virtualized. */
function DlqTable({
  shownGroups,
  hidden,
  canManage,
  scrollContainerRef,
  onAct,
}: {
  shownGroups: DlqRowGroup[];
  hidden: boolean;
  canManage: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onAct: (kind: "redrive" | "discard", group: DlqRowGroup) => void;
}) {
  return (
    <Box
      ref={scrollContainerRef}
      maxHeight={`${DLQ_VIEWPORT_HEIGHT}px`}
      overflowY="auto"
      hidden={hidden}
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
            {canManage && (
              <Table.ColumnHeader width="130px">Actions</Table.ColumnHeader>
            )}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <VirtualizedTableRows
            count={shownGroups.length}
            rowHeight={DLQ_ROW_HEIGHT}
            columnCount={canManage ? 6 : 5}
            scrollContainerRef={scrollContainerRef}
            getItemKey={(i) => {
              const g = shownGroups[i]!;
              return `${g.queueName}:${g.groupId}`;
            }}
            renderRow={(i) => (
              <DlqRow
                group={shownGroups[i]!}
                canManage={canManage}
                onAct={onAct}
              />
            )}
          />
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

/**
 * The three confirmations, each naming its blast radius in the operator's own
 * terms (best_practices/ops-dashboard.md): which groups, in which queue, and
 * for a discard, that the audit trail is what survives.
 */
function DlqConfirms({
  actions,
  canaryCount,
}: {
  actions: ReturnType<typeof useDlqActions>;
  canaryCount: number;
}) {
  const { pending, canaryTarget } = actions;
  const one = pending?.groupIds.length === 1;
  const target = one
    ? `"${pending?.groupIds[0]}"`
    : `${pending?.groupIds.length} shown groups`;
  return (
    <>
      <ConfirmDialog
        open={pending?.kind === "redrive"}
        onClose={() => actions.setPending(null)}
        onConfirm={actions.confirmPending}
        title="Redrive from the dead-letter queue"
        description={`Return ${target} in "${pending?.queueDisplayName}" to the main queue for reprocessing.`}
        isLoading={actions.redrive.isPending}
      />
      <ConfirmDialog
        open={pending?.kind === "discard"}
        onClose={() => actions.setPending(null)}
        onConfirm={actions.confirmPending}
        title="Discard from the dead-letter queue"
        description={`Mark ${target} in "${pending?.queueDisplayName}" as never to be run. The act is recorded in the audit trail with the last error; the jobs will not run.`}
        isLoading={actions.discard.isPending}
      />
      <ConfirmDialog
        open={!!canaryTarget}
        onClose={() => actions.setCanaryTarget(null)}
        onConfirm={() => {
          if (canaryTarget) {
            actions.canaryRedrive.mutate({
              queueName: canaryTarget,
              count: canaryCount,
            });
          }
        }}
        title="Canary Redrive"
        description={`Redrive ${canaryCount} random dead-letter groups from "${canaryTarget}" as a canary.`}
        isLoading={actions.canaryRedrive.isPending}
      />
    </>
  );
}
