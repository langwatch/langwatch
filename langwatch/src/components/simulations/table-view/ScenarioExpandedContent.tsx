import { useMemo } from "react";
import { Box, Text } from "@chakra-ui/react";
import { DataGridTable } from "~/components/ui/datagrid/DataGridTable";
import { useDrawer } from "~/hooks/useDrawer";
import { createTraceColumns } from "./traceColumns";
import type { ScenarioRunRow, TraceRow } from "./types";

interface ScenarioExpandedContentProps {
  row: ScenarioRunRow;
}

/**
 * Expanded row content showing traces for a scenario run
 * Uses DataGridTable for consistent UX with the parent table
 */
export function ScenarioExpandedContent({ row }: ScenarioExpandedContentProps) {
  const { openDrawer } = useDrawer();
  const traces = row.traces ?? [];

  // Create columns for the trace table
  const traceColumns = useMemo(() => createTraceColumns(), []);

  // All columns visible by default
  const visibleColumns = useMemo(
    () => new Set(traceColumns.map((col) => col.id)),
    [traceColumns]
  );

  // Handle row click - open trace details drawer
  const handleRowClick = (trace: TraceRow) => {
    openDrawer("traceDetails", { traceId: trace.traceId });
  };

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
      <Box
        border="1px solid"
        borderColor="gray.200"
        borderRadius="md"
        overflow="hidden"
        bg="white"
      >
        <DataGridTable<TraceRow>
          data={traces}
          columns={traceColumns}
          visibleColumns={visibleColumns}
          sorting={null}
          filters={[]}
          groupBy={null}
          expandedRows={new Set()}
          getRowId={(trace) => trace.traceId}
          onSort={() => {}}
          onAddFilter={() => {}}
          onRemoveFilter={() => {}}
          onGroupBy={() => {}}
          onToggleColumnVisibility={() => {}}
          onPinColumn={() => {}}
          onToggleRowExpansion={() => {}}
          onRowClick={handleRowClick}
          emptyMessage="No traces available"
        />
      </Box>
    </Box>
  );
}
