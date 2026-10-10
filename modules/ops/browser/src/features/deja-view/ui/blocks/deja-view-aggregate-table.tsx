import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Card, Table, Text } from "@langwatch/design-system/primitives";
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
    <Card.Root borderColor="border.muted" boxShadow="none" overflow="hidden">
      <Table.ScrollArea>
        <ListTable
          density="compact"
          columnRules={false}
          containerProps={{ overflowX: "auto" }}
          size="sm"
          variant="line"
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Aggregate ID</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader>Tenant</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Event count</Table.ColumnHeader>
              <Table.ColumnHeader>Last event</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {aggregates.map((agg) => (
              <Table.Row
                key={`${agg.tenantId}:${agg.aggregateId}`}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => onSelect(agg.aggregateId, agg.tenantId)}
              >
                <Table.Cell>
                  <Text textStyle="xs" fontFamily="mono">
                    {agg.aggregateId}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <InlineCode>{agg.aggregateType}</InlineCode>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" fontFamily="mono" color="fg.muted">
                    {agg.tenantId}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Text textStyle="sm" fontWeight="medium">
                    {agg.eventCount}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" color="fg.muted">
                    {formatTimestamp(agg.lastEventTime)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <ChevronRight size={14} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </ListTable>
      </Table.ScrollArea>
    </Card.Root>
  );
}
