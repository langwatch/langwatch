import { Badge, Box, Card, HStack, Table, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import NextLink from "next/link";
import { formatDuration } from "~/components/ops/shared/formatters";
import { api } from "~/utils/api";

export function ReplayHistorySection() {
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const entries = historyQuery.data ?? [];
  // Show only the latest entry on the dashboard
  const latestEntry = entries[0];

  return (
    <Card.Root overflow="hidden">
      <NextLink href="/ops/projections" style={{ textDecoration: "none" }}>
        <HStack
          paddingX={4}
          paddingTop={3}
          paddingBottom={2}
          cursor="pointer"
          _hover={{ color: "orange.500" }}
          transition="color 0.1s"
        >
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Replay History
          </Text>
          <ArrowUpRight size={10} />
        </HStack>
      </NextLink>
      {latestEntry ? (
        <Table.ScrollArea>
          <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader width="40px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Badge
                    size="sm"
                    colorPalette={
                      latestEntry.state === "completed"
                        ? "green"
                        : latestEntry.state === "failed"
                          ? "red"
                          : latestEntry.state === "running"
                            ? "blue"
                            : "orange"
                    }
                  >
                    {latestEntry.state}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" truncate maxWidth="240px">
                    {latestEntry.description || "\u2014"}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Text textStyle="xs">
                    {formatDuration(latestEntry.startedAt, latestEntry.completedAt)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                    {latestEntry.completedAt
                      ? new Date(latestEntry.completedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "\u2014"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <NextLink
                    href={`/ops/projections/${latestEntry.runId}`}
                    style={{ textDecoration: "none" }}
                  >
                    <ArrowUpRight
                      size={12}
                      style={{ cursor: "pointer", opacity: 0.5 }}
                    />
                  </NextLink>
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      ) : (
        <Box paddingX={4} paddingBottom={4}>
          <Text textStyle="xs" color="fg.muted">
            No replay history
          </Text>
        </Box>
      )}
    </Card.Root>
  );
}
