import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Text } from "@langwatch/design-system/primitives";
import { ChevronRight } from "lucide-react";

import { formatTimestamp } from "../../model/deja-view-fragment.ts";
import type { AggregateResult } from "../../model/deja-view-types.ts";

export function AggregateTable({
  aggregates,
  onSelect,
}: {
  aggregates: AggregateResult[];
  onSelect: (aggregateId: string, tenantId: string) => void;
}) {
  return (
    <Card padding="none">
      <ListTable
        density="compact"
        variant="embedded"
        scroll="x"
        scrollLabel="Aggregate search results"
      >
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Aggregate ID</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Type</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Tenant</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Event count</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Last event</ListTable.ColumnHeader>
            <ListTable.ColumnHeader label="Open" />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {aggregates.map((agg) => (
            <ListTable.Row
              key={`${agg.tenantId}:${agg.aggregateId}`}
              onActivate={() => onSelect(agg.aggregateId, agg.tenantId)}
            >
              <ListTable.Cell>
                <ListTable.RowAction
                  label={`Open aggregate ${agg.aggregateId}`}
                  onActivate={() => onSelect(agg.aggregateId, agg.tenantId)}
                >
                  <InlineCode variant="neutral">{agg.aggregateId}</InlineCode>
                </ListTable.RowAction>
              </ListTable.Cell>
              <ListTable.Cell>
                <InlineCode>{agg.aggregateType}</InlineCode>
              </ListTable.Cell>
              <ListTable.Cell>
                <InlineCode variant="neutral">{agg.tenantId}</InlineCode>
              </ListTable.Cell>
              <ListTable.Cell align="end">
                <Text textStyle="sm" fontWeight="medium">
                  {agg.eventCount}
                </Text>
              </ListTable.Cell>
              <ListTable.Cell>
                <Text textStyle="xs" color="fg.muted">
                  {formatTimestamp(agg.lastEventTime)}
                </Text>
              </ListTable.Cell>
              <ListTable.Cell>
                <ChevronRight size={14} />
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </Card>
  );
}
