import { Badge, Card, Table, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import { formatTimestamp } from "./fragment";
import type { AggregateResult } from "./types";

export function AggregateTable({
  aggregates,
  onSelect,
}: {
  aggregates: AggregateResult[];
  onSelect: (aggregateId: string, tenantId: string) => void;
}) {
  return (
    <Card.Root overflow="hidden">
      <Table.ScrollArea>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Aggregate ID</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader>Tenant</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Event Count
              </Table.ColumnHeader>
              <Table.ColumnHeader>Last Event</Table.ColumnHeader>
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
                  <Badge size="sm" variant="subtle">
                    {agg.aggregateType}
                  </Badge>
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
        </Table.Root>
      </Table.ScrollArea>
    </Card.Root>
  );
}
