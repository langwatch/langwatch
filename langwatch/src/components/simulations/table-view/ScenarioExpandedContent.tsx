import { Box, Table, Text } from "@chakra-ui/react";
import type { ScenarioRunRow, TraceRow } from "./types";

interface ScenarioExpandedContentProps {
  row: ScenarioRunRow;
}

/**
 * Expanded row content showing traces for a scenario run
 */
export function ScenarioExpandedContent({ row }: ScenarioExpandedContentProps) {
  const traces = row.traces ?? [];

  if (traces.length === 0) {
    return (
      <Box p={4} bg="gray.50">
        <Text color="gray.500" fontSize="sm">
          No traces available for this scenario run.
        </Text>
      </Box>
    );
  }

  return (
    <Box p={4} bg="gray.50">
      <Text fontWeight="medium" fontSize="sm" mb={2}>
        Traces ({traces.length})
      </Text>
      <Table.Root size="sm" variant="outline">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Trace ID</Table.ColumnHeader>
            <Table.ColumnHeader>Input</Table.ColumnHeader>
            <Table.ColumnHeader>Output</Table.ColumnHeader>
            <Table.ColumnHeader>Tokens</Table.ColumnHeader>
            <Table.ColumnHeader>Cost</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {traces.map((trace) => (
            <TraceTableRow key={trace.traceId} trace={trace} />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

interface TraceTableRowProps {
  trace: TraceRow;
}

function TraceTableRow({ trace }: TraceTableRowProps) {
  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "-";
    return `$${cost.toFixed(4)}`;
  };

  return (
    <Table.Row>
      <Table.Cell>
        <Text fontFamily="mono" fontSize="xs">
          {truncate(trace.traceId, 12)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" maxW="200px" truncate>
          {truncate(trace.input, 50)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" maxW="200px" truncate>
          {truncate(trace.output, 50)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm">{trace.totalTokens || "-"}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm">{formatCost(trace.totalCost)}</Text>
      </Table.Cell>
    </Table.Row>
  );
}
