import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Card, HStack, Table, Text } from "@langwatch/design-system/primitives";
import { Layers } from "lucide-react";

import type { ProjectionHealthRow } from "../../model/projection-health.ts";

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
        <Text textStyle="xs" fontFamily="mono" color={row.blocked > 0 ? "fg.error" : "fg.muted"}>
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

/** Every registered projection with its live queue health. */
export function ProjectionsCard({ rows }: { rows: ProjectionHealthRow[] }) {
  return (
    <Card.Root borderColor="border.muted" boxShadow="none">
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">
            Projections
          </Text>
        </HStack>
        {rows.length === 0 ? (
          <NoDataInfoBlock
            icon={<Layers />}
            title="No projections registered."
            description="Registered projections and their current work appear here."
          />
        ) : (
          <ListTable
            density="compact"
            columnRules={false}
            containerProps={{ overflowX: "auto" }}
            size="sm"
            variant="line"
          >
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
          </ListTable>
        )}
      </Card.Body>
    </Card.Root>
  );
}
