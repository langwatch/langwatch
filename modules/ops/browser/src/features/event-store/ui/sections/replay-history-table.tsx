import { Card } from "@langwatch/design-system/card";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import { LoadMore } from "@langwatch/design-system/load-more";
import { Badge, Button, HStack, Status, Text } from "@langwatch/design-system/primitives";
import type { ReplayHistoryEntry } from "@langwatch/ops-contract";
import { ArrowRight } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import { formatDuration } from "../../../../model/ops-formatters.ts";
import { replayStateColor } from "../elements/replay-state-badge.tsx";

const HISTORY_PAGE_SIZE = 20;

export function ReplayHistoryTable() {
  const router = useRouter();
  const historyQuery = api.ops.getReplayHistoryPage.useInfiniteQuery(
    { limit: HISTORY_PAGE_SIZE },
    {
      getNextPageParam: (lastPage) =>
        lastPage.outcome === "page" ? (lastPage.nextCursor ?? void 0) : void 0,
    },
  );

  const pages = historyQuery.data?.pages ?? [];
  const history: ReplayHistoryEntry[] = pages.flatMap((page) =>
    page.outcome === "page" ? page.entries : [],
  );
  const expired = pages.some((page) => page.outcome === "cursor_expired");
  if (history.length === 0) return null;

  return (
    <Card padding="none" title="Replay history">
      <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Replay history table">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Description</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Projections</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Duration</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Aggregates</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Events</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>When</ListTable.ColumnHeader>
            <ListTable.ColumnHeader width="40px" label="Open" />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {history.map((run) => {
            const stateColor = replayStateColor(run.state);
            const href = `/ops/projections/${run.runId}`;

            return (
              <ListTable.Row key={run.runId} onActivate={() => router.push(href)}>
                <ListTable.Cell>
                  <ListTable.RowAction
                    href={href}
                    onNavigate={({ href: target }) => router.push(target)}
                    label={`Open ${run.state} replay ${run.runId}`}
                  >
                    <HStack gap={2}>
                      <Status.Root colorPalette={stateColor}>
                        <Status.Indicator />
                      </Status.Root>
                      <Badge size="sm" variant="subtle" colorPalette={stateColor}>
                        {run.state}
                      </Badge>
                    </HStack>
                  </ListTable.RowAction>
                </ListTable.Cell>
                <ListTable.Cell>
                  <Text textStyle="xs" truncate maxW="300px">
                    {run.description ?? "—"}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell>
                  <Text textStyle="xs" color="fg.muted">
                    {run.projectionNames?.length ?? 0} projection
                    {(run.projectionNames?.length ?? 0) !== 1 ? "s" : ""}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell align="end">
                  <Text textStyle="xs">{formatDuration(run.startedAt, run.completedAt)}</Text>
                </ListTable.Cell>
                <ListTable.Cell align="end">
                  <Text textStyle="xs">
                    <FormattedNumber value={run.aggregatesProcessed ?? 0} />
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell align="end">
                  <Text textStyle="xs">
                    <FormattedNumber value={run.eventsProcessed ?? 0} />
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell nowrap>
                  <Text textStyle="xs" color="fg.muted">
                    {run.startedAt ? (
                      <FormattedDate value={run.startedAt} display="datetime" />
                    ) : (
                      <EmptyValue />
                    )}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell>
                  <ArrowRight size={12} style={{ opacity: 0.5 }} aria-hidden />
                </ListTable.Cell>
              </ListTable.Row>
            );
          })}
        </ListTable.Body>
      </ListTable>
      {expired && (
        <HStack justify="center" gap={2} paddingY={3}>
          <Text as="output" textStyle="xs" color="fg.muted">
            The history moved on while you were reading.
          </Text>
          <Button size="xs" variant="outline" onClick={() => void historyQuery.refetch()}>
            Show newest runs
          </Button>
        </HStack>
      )}
      <LoadMore
        hasMore={!expired && (historyQuery.hasNextPage ?? false)}
        loading={historyQuery.isFetchingNextPage}
        onLoadMore={() => void historyQuery.fetchNextPage()}
      />
    </Card>
  );
}
