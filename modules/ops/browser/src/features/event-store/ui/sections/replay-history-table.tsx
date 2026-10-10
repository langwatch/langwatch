import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, Card, HStack, Status, Table, Text } from "@langwatch/design-system/primitives";
import type { ReplayHistoryEntry } from "@langwatch/ops-contract";
import { readableDate } from "@langwatch/time";
import { ArrowRight } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import { formatDuration } from "../../../../model/ops-formatters.ts";
import { replayStateColor } from "../elements/replay-state-badge.tsx";

export function ReplayHistoryTable() {
  const router = useRouter();
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {});

  const history = historyQuery.data;
  if (!history || history.length === 0) return null;

  return (
    <Card.Root borderColor="border.muted" boxShadow="none" overflow={"hidden"}>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={3}>
          <Text textStyle="sm" fontWeight="medium">
            Replay history
          </Text>
        </HStack>
        <Table.ScrollArea>
          <ListTable
            density="compact"
            columnRules={false}
            containerProps={{ overflowX: "auto" }}
            size="sm"
            variant="line"
          >
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
                <Table.ColumnHeader>Projections</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Aggregates</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Events</Table.ColumnHeader>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader width="40px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {history.map((run: ReplayHistoryEntry) => {
                const stateColor = replayStateColor(run.state);

                return (
                  <Table.Row
                    key={run.runId}
                    cursor="pointer"
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() => router.push(`/ops/projections/${run.runId}`)}
                  >
                    <Table.Cell>
                      <HStack gap={2}>
                        <Status.Root colorPalette={stateColor}>
                          <Status.Indicator />
                        </Status.Root>
                        <Badge size="sm" variant="subtle" colorPalette={stateColor}>
                          {run.state}
                        </Badge>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" truncate maxW="300px">
                        {run.description ?? "\u2014"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted">
                        {run.projectionNames?.length ?? 0} projection
                        {(run.projectionNames?.length ?? 0) !== 1 ? "s" : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">{formatDuration(run.startedAt, run.completedAt)}</Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">{(run.aggregatesProcessed ?? 0).toLocaleString()}</Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">{(run.eventsProcessed ?? 0).toLocaleString()}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                        {run.startedAt
                          ? readableDate(run.startedAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "\u2014"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <ArrowRight size={12} style={{ opacity: 0.5 }} />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </ListTable>
        </Table.ScrollArea>
      </Card.Body>
    </Card.Root>
  );
}
