import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, HStack, Spacer, Text } from "@langwatch/design-system/primitives";
import type { ProcessFleetSummary } from "@langwatch/ops-contract";
import { Workflow } from "lucide-react";

import { hasFleetTrouble } from "../../model/process-presentation.ts";

function CountCell({ value, color }: { value: number; color?: string }) {
  return (
    <ListTable.Cell align="end">
      <Text
        textStyle="caption"
        fontVariantNumeric="tabular-nums"
        color={value > 0 ? color : "fg.muted"}
        fontWeight={value > 0 && color ? "medium" : undefined}
      >
        {value}
      </Text>
    </ListTable.Cell>
  );
}

function fleetRowTone(row: ProcessFleetSummary): "warning" | "danger" | undefined {
  if (row.deadMessages > 0) return "danger";
  if (hasFleetTrouble(row)) return "warning";
  return undefined;
}

function FleetRow({
  row,
  onSelect,
}: {
  row: ProcessFleetSummary;
  onSelect: (processName: string) => void;
}) {
  return (
    <ListTable.Row
      data-testid={`process-row-${row.processName}`}
      tone={fleetRowTone(row)}
      onActivate={() => onSelect(row.processName)}
    >
      <ListTable.Cell>
        <HStack gap={1.5}>
          <ListTable.RowAction
            label={`Open instances of ${row.processName}`}
            onActivate={() => onSelect(row.processName)}
          >
            <InlineCode variant="neutral">{row.processName}</InlineCode>
          </ListTable.RowAction>
          {row.scheduled && (
            <Badge size="xs" variant="subtle" colorPalette="gray">
              scheduled
            </Badge>
          )}
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap" title={row.pipelineName}>
          {row.pipelineName}
        </Text>
      </ListTable.Cell>
      <CountCell value={row.instances} />
      <CountCell value={row.overdueWakes} color="fg.warning" />
      <CountCell value={row.pendingMessages} />
      <CountCell value={row.overduePending} color="fg.warning" />
      <CountCell value={row.lapsedLeases} color="fg.warning" />
      <CountCell value={row.deadMessages} color="fg.error" />
    </ListTable.Row>
  );
}

/**
 * One row per process name: registry identity + live trouble counts, trouble
 * sorted first by the server. Clicking a row opens its instances drawer.
 */
export function ProcessFleetCard({
  rows,
  onSelect,
  onOpenAll,
}: {
  rows: ProcessFleetSummary[];
  onSelect: (processName: string) => void;
  onOpenAll?: () => void;
}) {
  return (
    <Card padding="none">
      <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
        <Text textStyle="sm" fontWeight="medium">
          Process managers
        </Text>
        <Spacer />
        {onOpenAll && (
          <Button size="sm" variant="outline" onClick={onOpenAll}>
            All instances
          </Button>
        )}
      </HStack>
      {rows.length === 0 ? (
        <NoDataInfoBlock
          icon={<Workflow />}
          title="No process managers registered."
          description="Registered processes and their health appear here."
        />
      ) : (
        <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Process managers">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Process</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Pipeline</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Instances</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Overdue wakes</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Pending</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Overdue pending</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Lapsed leases</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Dead</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((row) => (
              <FleetRow key={row.processName} row={row} onSelect={onSelect} />
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
