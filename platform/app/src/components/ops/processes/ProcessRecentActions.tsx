import { Box, Card, HStack, Table, Text } from "@chakra-ui/react";
import { middleEllipsis } from "@langwatch/ops-web";
import { formatTimeAgo } from "@langwatch/ops-web";
import { api } from "~/utils/api";

const ACTION_LABELS: Record<string, string> = {
  process_wake_now: "Wake now",
  process_redrive_dead_instance: "Redrive dead (instance)",
  process_redrive_dead_message: "Redrive dead message",
  process_release_lapsed_lease: "Release lapsed lease",
};

/** Recent operator actions, so "why did this run at 03:14" is answerable here. */
export function ProcessRecentActions() {
  const query = api.ops.listProcessActions.useQuery(
    { limit: 20 },
    { refetchInterval: 30_000 },
  );
  const rows = query.data ?? [];
  const now = query.dataUpdatedAt || Date.now();

  if (rows.length === 0) return null;

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack
          paddingX={4}
          paddingY={2.5}
          borderBottom="1px solid"
          borderBottomColor="border"
        >
          <Text textStyle="sm" fontWeight="medium">
            Recent Actions
          </Text>
        </HStack>
        <Box maxHeight="240px" overflowY="auto">
          <Table.Root size="sm" variant="line">
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.id}>
                  <Table.Cell width="140px">
                    <Text textStyle="xs" color="fg.muted">
                      {formatTimeAgo(row.createdAt, now)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell width="200px">
                    <Text textStyle="xs">{ACTION_LABELS[row.action] ?? row.action}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text
                      textStyle="xs"
                      fontFamily="mono"
                      color="fg.muted"
                      title={row.targetId}
                    >
                      {middleEllipsis(row.targetId, 64)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </Card.Body>
    </Card.Root>
  );
}
