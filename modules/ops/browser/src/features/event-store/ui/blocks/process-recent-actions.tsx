import { Card } from "@langwatch/design-system/card";
import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";

const ACTION_LABELS: Record<string, string> = {
  process_wake_now: "Wake now",
  process_redrive_dead_instance: "Redrive dead (instance)",
  process_redrive_dead_message: "Redrive dead message",
  process_release_lapsed_lease: "Release lapsed lease",
};

/** Recent operator actions, so "why did this run at 03:14" is answerable here. */
export function ProcessRecentActions({ rows, now }: { rows: ProcessAction[]; now: number }) {
  if (rows.length === 0) return null;

  return (
    <Card padding="none">
      <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
        <Text textStyle="sm" fontWeight="medium">
          Recent actions
        </Text>
      </HStack>
      <Box maxHeight="240px" overflowY="auto">
        <ListTable density="compact" variant="embedded">
          <ListTable.Body>
            {rows.map((row) => (
              <ListTable.Row key={row.id}>
                <ListTable.Cell width={140}>
                  <Text textStyle="xs" color="fg.muted">
                    {formatTimeAgo(row.createdAt, now)}
                  </Text>
                </ListTable.Cell>
                <ListTable.Cell width={200}>
                  <Text textStyle="xs">{ACTION_LABELS[row.action] ?? row.action}</Text>
                </ListTable.Cell>
                <ListTable.Cell>
                  <IdText value={row.targetId} label="ID" />
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      </Box>
    </Card>
  );
}

export interface ProcessAction {
  id: string;
  action: string;
  targetId: string;
  createdAt: number;
}
