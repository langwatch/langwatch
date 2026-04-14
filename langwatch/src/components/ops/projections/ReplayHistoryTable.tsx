import { useRouter } from "next/router";
import { Badge, Card, HStack, Status, Table, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { api } from "~/utils/api";
import { formatDuration } from "~/components/ops/shared/formatters";
import { replayStateColor } from "~/components/ops/shared/ReplayStateBadge";

export function ReplayHistoryTable() {
  const router = useRouter();
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const history = historyQuery.data;
  if (!history || history.length === 0) return null;

  return (
    <Card.Root overflow={"hidden"}>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={3}>
          <Text textStyle="sm" fontWeight="medium">
            Replay History
          </Text>
        </HStack>
        <Table.ScrollArea>
          <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
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
              {history.map((run: any) => {
                const stateColor = replayStateColor(run.state);

                return (
                  <Table.Row
                    key={run.runId}
                    cursor="pointer"
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() =>
                      void router.push(`/ops/projections/${run.runId}`)
                    }
                  >
                    <Table.Cell>
                      <HStack gap={2}>
                        <Status.Root colorPalette={stateColor}>
                          <Status.Indicator />
                        </Status.Root>
                        <Badge
                          size="sm"
                          variant="subtle"
                          colorPalette={stateColor}
                        >
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
                      <Text textStyle="xs">
                        {formatDuration(run.startedAt, run.completedAt)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">
                        {(run.aggregatesProcessed ?? 0).toLocaleString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">
                        {(run.eventsProcessed ?? 0).toLocaleString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "\u2014"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <ArrowRight
                        size={12}
                        style={{ opacity: 0.5 }}
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Card.Body>
    </Card.Root>
  );
}
