import { Badge, Box, Card, HStack, Table, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { api } from "~/utils/api";
import { joinProjectionHealth, type ProjectionHealthRow } from "@langwatch/ops-web";

function ProjectionRow({ row }: { row: ProjectionHealthRow }) {
  return (
    <Table.Row bg={row.blocked > 0 ? "red.subtle" : undefined}>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono">
          {row.projectionName}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {row.pipelineName}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Badge size="xs" variant="subtle" colorPalette="teal">
          {row.kind}
        </Badge>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.pending}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {row.active}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text
          textStyle="xs"
          fontFamily="mono"
          color={row.blocked > 0 ? "red.500" : "fg.muted"}
        >
          {row.blocked}
        </Text>
      </Table.Cell>
      <Table.Cell>
        {row.hasLiveNode ? (
          <Badge size="xs" colorPalette="green" variant="subtle">
            Live
          </Badge>
        ) : (
          <Badge size="xs" colorPalette="gray" variant="subtle">
            Idle
          </Badge>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * Every registered projection with its live queue health, registry-driven
 * like the subscribers card. Rebuild tooling stays on Projection Replay,
 * linked from here rather than duplicated.
 */
export function ProjectionsCard() {
  const registry = api.ops.listProjections.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const dashboard = api.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const rows = useMemo(
    () =>
      joinProjectionHealth({
        projections: registry.data?.projections ?? [],
        pipelineTree: dashboard.data?.pipelineTree ?? [],
      }),
    [registry.data, dashboard.data],
  );

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
            Projections
          </Text>
        </HStack>
        {rows.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">
              No projections registered.
            </Text>
          </Box>
        ) : (
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Projection</Table.ColumnHeader>
                <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                <Table.ColumnHeader>Kind</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Active</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Blocked</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <ProjectionRow
                  key={`${row.pipelineName}/${row.kind}/${row.projectionName}`}
                  row={row}
                />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}
