import { Badge, Box, Button, Card, HStack, Spacer, Table, Text } from "@chakra-ui/react";
import type { ProcessFleetSummary } from "@langwatch/ops-contract";
import { hasFleetTrouble } from "../../model/process-presentation";

function CountCell({ value, color }: { value: number; color?: string }) {
  return (
    <Table.Cell textAlign="end">
      <Text
        textStyle="xs"
        fontFamily="mono"
        color={value > 0 ? color : "fg.muted"}
        fontWeight={value > 0 && color ? "medium" : undefined}
      >
        {value}
      </Text>
    </Table.Cell>
  );
}

function fleetRowTint(row: ProcessFleetSummary): string | undefined {
  if (row.deadMessages > 0) return "red.subtle";
  if (hasFleetTrouble(row)) return "orange.subtle";
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
    <Table.Row
      cursor="pointer"
      data-testid={`process-row-${row.processName}`}
      bg={fleetRowTint(row)}
      _hover={{ bg: "bg.subtle" }}
      onClick={() => onSelect(row.processName)}
    >
      <Table.Cell>
        <HStack gap={1.5}>
          <Text textStyle="xs" fontFamily="mono">
            {row.processName}
          </Text>
          {row.scheduled && (
            <Badge size="xs" variant="subtle" colorPalette="gray">
              scheduled
            </Badge>
          )}
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {row.pipelineName}
        </Text>
      </Table.Cell>
      <CountCell value={row.instances} />
      <CountCell value={row.overdueWakes} color="orange.500" />
      <CountCell value={row.pendingMessages} />
      <CountCell value={row.overduePending} color="orange.500" />
      <CountCell value={row.lapsedLeases} color="orange.500" />
      <CountCell value={row.deadMessages} color="red.500" />
    </Table.Row>
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
    <Card.Root>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">
            Process Managers
          </Text>
          <Spacer />
          {onOpenAll && (
            <Button size="2xs" variant="outline" onClick={onOpenAll}>
              All instances
            </Button>
          )}
        </HStack>
        {rows.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">
              No process managers registered.
            </Text>
          </Box>
        ) : (
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Process</Table.ColumnHeader>
                <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Instances</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Overdue wakes</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Overdue pending</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Lapsed leases</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Dead</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <FleetRow key={row.processName} row={row} onSelect={onSelect} />
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card.Body>
    </Card.Root>
  );
}
