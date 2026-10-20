import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";
import { Layers } from "lucide-react";

import type { ProjectionHealthRow } from "../../model/projection-health.ts";

function ProjectionRow({ row }: { row: ProjectionHealthRow }) {
  return (
    <ListTable.Row tone={row.blocked > 0 ? "danger" : undefined}>
      <ListTable.Cell>
        <InlineCode variant="neutral">{row.projectionName}</InlineCode>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="xs" color="fg.muted">
          {row.pipelineName}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Badge size="xs" variant="subtle" colorPalette="teal">
          {row.kind}
        </Badge>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.pending}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text textStyle="caption" fontVariantNumeric="tabular-nums">
          {row.active}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text
          textStyle="caption"
          fontVariantNumeric="tabular-nums"
          color={row.blocked > 0 ? "fg.error" : "fg.muted"}
        >
          {row.blocked}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        {row.hasLiveNode ? (
          <Badge size="xs" colorPalette="green" variant="subtle">
            Live
          </Badge>
        ) : (
          <Badge size="xs" colorPalette="gray" variant="subtle">
            Idle
          </Badge>
        )}
      </ListTable.Cell>
    </ListTable.Row>
  );
}

/** Every registered projection with its live queue health. */
export function ProjectionsCard({ rows }: { rows: ProjectionHealthRow[] }) {
  return (
    <Card padding="none">
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
        <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Projections">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Projection</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Pipeline</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Kind</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Pending</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Active</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Blocked</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((row) => (
              <ProjectionRow
                key={`${row.pipelineName}/${row.kind}/${row.projectionName}`}
                row={row}
              />
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
