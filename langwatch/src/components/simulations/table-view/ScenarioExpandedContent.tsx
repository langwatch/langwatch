import { useMemo } from "react";
import { Box, Text, Spinner, Center } from "@chakra-ui/react";
import { DataGridTable } from "~/components/ui/datagrid/DataGridTable";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createTraceColumns } from "./traceColumns";
import type { ScenarioRunRow, TraceRow } from "./types";

interface ScenarioExpandedContentProps {
  row: ScenarioRunRow;
}

/**
 * Expanded row content showing traces for a scenario run
 * Fetches actual trace data from Elasticsearch for accurate metrics
 */
export function ScenarioExpandedContent({ row }: ScenarioExpandedContentProps) {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  // Extract trace IDs from the row
  const traceIds = useMemo(
    () => row.traces?.map((t) => t.traceId) ?? [],
    [row.traces]
  );

  // Fetch actual trace data with spans from Elasticsearch
  const { data: fetchedTraces, isLoading } = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds,
    },
    {
      enabled: !!project?.id && traceIds.length > 0,
    }
  );

  // Transform fetched traces to TraceRow format
  const traces: TraceRow[] = useMemo(() => {
    if (!fetchedTraces) {
      return row.traces ?? [];
    }

    return fetchedTraces.map((trace) => ({
      traceId: trace.trace_id,
      timestamp: trace.timestamps?.started_at
        ? new Date(trace.timestamps.started_at).getTime()
        : 0,
      input: typeof trace.input?.value === "string"
        ? trace.input.value
        : JSON.stringify(trace.input?.value ?? ""),
      output: typeof trace.output?.value === "string"
        ? trace.output.value
        : JSON.stringify(trace.output?.value ?? ""),
      metadata: trace.metadata ?? {},
      spanCount: trace.spans?.length ?? 0,
      totalTokens:
        (trace.metrics?.prompt_tokens ?? 0) +
        (trace.metrics?.completion_tokens ?? 0),
      totalCost: trace.metrics?.total_cost ?? 0,
    }));
  }, [fetchedTraces, row.traces]);

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

  if (traceIds.length === 0) {
    return (
      <Box p={4} bg="gray.50">
        <Text color="gray.500" fontSize="sm">
          No traces available for this scenario run.
        </Text>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <Box p={4} bg="gray.50">
        <Center py={4}>
          <Spinner size="sm" mr={2} />
          <Text color="gray.500" fontSize="sm">Loading traces...</Text>
        </Center>
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
