import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { HStack, Text } from "@langwatch/design-system/primitives";
import type { DashboardData } from "@langwatch/ops-contract";

/**
 * Blocked-group error clusters. Renders only when there is something to
 * report - the all-clear case collapses onto the dashboard's health line.
 * Clusters come from the snapshot's exhaustive blocked walk, matching the drill-down.
 */
export function TopErrorsCard({
  topErrors,
  errorClustersBound,
}: Pick<DashboardData, "topErrors" | "errorClustersBound">) {
  if (topErrors.length === 0) return null;

  // The table renders at most five rows. That bound is the page's own, not the
  // snapshot's, and an undisclosed cap is exactly the silent truncation this
  // work exists to remove — so it reports itself alongside the snapshot's.
  const VISIBLE_ROWS = 5;
  const shown = Math.min(topErrors.length, VISIBLE_ROWS);
  const known = Math.max(errorClustersBound.total, topErrors.length);
  const truncated = known > shown;

  return (
    <Card padding="none">
      <HStack paddingX={4} paddingTop={3} paddingBottom={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Top errors
        </Text>
        {truncated && (
          <Text textStyle="xs" color="fg.muted">
            showing {shown} of {known}
          </Text>
        )}
      </HStack>
      <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Top errors">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader width={60}>Count</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Error</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Pipeline</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {topErrors.slice(0, VISIBLE_ROWS).map((err) => (
            <ListTable.Row key={`${err.queueName}::${err.normalizedMessage}`}>
              <ListTable.Cell>
                <Text color="red.fg" fontWeight="medium">
                  {err.count}
                </Text>
              </ListTable.Cell>
              <ListTable.Cell>
                <Text truncate maxWidth="400px">
                  {err.sampleMessage}
                </Text>
              </ListTable.Cell>
              <ListTable.Cell tone="muted">{err.pipelineName ?? "—"}</ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </Card>
  );
}
