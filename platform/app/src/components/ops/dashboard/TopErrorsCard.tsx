import { Card, HStack, Table, Text } from "@chakra-ui/react";
import type { DashboardData } from "~/server/app-layer/ops/types";

/**
 * Blocked-group error clusters.
 *
 * Renders only when there is something to report — the all-clear case collapses
 * onto the dashboard's health line instead of spending a card saying "No
 * errors". The clusters come from the snapshot's EXHAUSTIVE blocked walk, so
 * this and the blocked drill-down can no longer disagree about what exists.
 */
export function TopErrorsCard({
  topErrors,
  errorClustersBound,
}: Pick<DashboardData, "topErrors" | "errorClustersBound">) {
  if (topErrors.length === 0) return null;

  const truncated = errorClustersBound.total > errorClustersBound.included;

  return (
    <Card.Root overflow="hidden">
      <HStack paddingX={4} paddingTop={3} paddingBottom={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Top errors
        </Text>
        {truncated && (
          <Text textStyle="xs" color="fg.muted">
            showing {errorClustersBound.included} of {errorClustersBound.total}
          </Text>
        )}
      </HStack>
      <Table.ScrollArea>
        <Table.Root
          size="sm"
          variant="line"
          css={{ "& tr:last-child td": { borderBottom: "none" } }}
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader width="60px">Count</Table.ColumnHeader>
              <Table.ColumnHeader>Error</Table.ColumnHeader>
              <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {topErrors.slice(0, 5).map((err) => (
              <Table.Row key={`${err.queueName}::${err.normalizedMessage}`}>
                <Table.Cell>
                  <Text color="red.500" fontWeight="medium">
                    {err.count}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text truncate maxWidth="400px">
                    {err.sampleMessage}
                  </Text>
                </Table.Cell>
                <Table.Cell color="fg.muted">
                  {err.pipelineName ?? "—"}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    </Card.Root>
  );
}
