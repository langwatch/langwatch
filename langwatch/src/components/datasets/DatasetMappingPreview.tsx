import {
  Badge,
  Box,
  Button,
  Center,
  Field,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit2 } from "react-feather";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import {
  DatasetGrid,
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./DatasetGrid";

import type { CustomCellRendererProps } from "@ag-grid-community/react";
import type { Dataset } from "@prisma/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Checkbox } from "../../components/ui/checkbox";
import { Switch } from "../../components/ui/switch";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { MappingState } from "../../server/tracer/tracesMapping";
import { TracesMapping } from "../traces/TracesMapping";
import {
  ThreadMapping,
  type ThreadMappingState,
} from "../traces/ThreadMapping";
import { ErrorBoundary } from "react-error-boundary";
import type { Trace } from "~/server/tracer/types";
import { useDebouncedCallback } from "use-debounce";
interface DatasetMappingPreviewProps {
  traces: Trace[]; // Replace 'any' with your trace type
  columnTypes: DatasetColumns;
  rowData: DatasetRecordEntry[];
  selectedDataset: Dataset;
  onEditColumns: () => void;
  onRowDataChange: (entries: DatasetRecordEntry[]) => void;
  paragraph?: string;
  setDatasetTriggerMapping?: (mapping: MappingState) => void;
}

/**
 * DatasetMappingPreview component for configuring dataset mappings
 * Single Responsibility: Provide interface for mapping trace or thread data to dataset columns
 */
export function DatasetMappingPreview({
  traces,
  columnTypes,
  rowData,
  onEditColumns,
  onRowDataChange,
  paragraph,
  selectedDataset,
  setDatasetTriggerMapping,
}: DatasetMappingPreviewProps) {
  const [isThreadMapping, setIsThreadMapping] = useState(false);
  const [threadMappingState, setThreadMappingState] =
    useState<ThreadMappingState>();

  const { project } = useOrganizationTeamProject();

  // Extract thread_ids from traces
  const threadIds = useMemo(() => {
    const ids = traces
      .map((trace) => trace.metadata?.thread_id)
      .filter((id): id is string => !!id);
    return Array.from(new Set(ids));
  }, [traces]);

  // Fetch all traces with matching thread_ids when thread mapping is enabled
  const threadTraces = api.traces.getTracesWithSpansByThreadIds.useQuery(
    {
      projectId: project?.id ?? "",
      threadIds: threadIds,
    },
    {
      enabled: !!project && isThreadMapping && threadIds.length > 0,
      refetchOnWindowFocus: false,
    }
  );

  // Use thread traces when thread mapping is enabled, otherwise use provided traces
  const tracesToUse = useMemo(() => {
    if (isThreadMapping && threadTraces.data) {
      return threadTraces.data;
    }
    return traces;
  }, [isThreadMapping, threadTraces.data, traces]);

  const columnDefs = useMemo(() => {
    if (!selectedDataset) {
      return [];
    }

    const headers: DatasetColumnDef[] = (
      (selectedDataset.columnTypes as DatasetColumns) ?? []
    ).map(({ name, type }) => ({
      headerName: name,
      field: name,
      type_: type,
      cellClass: "v-align",
      sortable: false,
      minWidth: ["trace_id", "total_cost"].includes(name)
        ? 120
        : ["timestamp"].includes(name)
        ? 160
        : 200,
    }));

    // Add row number column
    headers.unshift({
      headerName: " ",
      field: "selected",
      type_: "boolean",
      width: 46,
      pinned: "left",
      sortable: false,
      filter: false,
      enableCellChangeFlash: false,
      headerComponent: HeaderCheckboxComponent,
      cellRenderer: (props: CustomCellRendererProps) => (
        <Checkbox
          marginLeft="3px"
          {...props}
          checked={props.value}
          onChange={(e) => props.setValue?.(e.target.checked)}
        />
      ),
    });

    return headers;
  }, [selectedDataset]);

  const trpc = api.useContext();
  const updateStoredMapping_ = api.dataset.updateMapping.useMutation();
  const updateStoredMapping = useCallback(
    (mappingState: MappingState) => {
      updateStoredMapping_.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: selectedDataset.id,
          mapping: {
            mapping: mappingState.mapping,
            expansions: Array.from(mappingState.expansions),
          },
        },
        {
          onSuccess: () => {
            void trpc.dataset.getAll.invalidate();
          },
        }
      );
    },
    [selectedDataset.id, project?.id, trpc.dataset.getAll, updateStoredMapping_]
  );

  const updateStoredThreadMapping = useCallback(
    (threadMapping: ThreadMappingState) => {
      updateStoredMapping_.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: selectedDataset.id,
          threadMapping: {
            mapping: threadMapping.mapping,
          },
        },
        {
          onSuccess: () => {
            void trpc.dataset.getAll.invalidate();
          },
        }
      );
    },
    [selectedDataset.id, project?.id, trpc.dataset.getAll, updateStoredMapping_]
  );

  const debouncedUpdateThreadMapping = useDebouncedCallback(
    (newThreadMapping: ThreadMappingState) => {
      setThreadMappingState(newThreadMapping);
      updateStoredThreadMapping(newThreadMapping);
    },
    400
  );

  // Clear thread mapping state and cancel pending updates when dataset changes
  useEffect(() => {
    setThreadMappingState(undefined);
    debouncedUpdateThreadMapping.cancel();
  }, [selectedDataset.id, debouncedUpdateThreadMapping]);

  // Get the current dataset's thread mapping
  const currentThreadMapping = useMemo(() => {
    return (selectedDataset.mapping as any)?.threadMapping as
      | ThreadMappingState
      | undefined;
  }, [selectedDataset.mapping]);

  return (
    <Field.Root width="full" paddingY={4}>
      <HStack width="full" gap="64px" align="start">
        <VStack align="start" maxWidth="50%" gap={4}>
          <HStack width="full" align="center" justify="space-between">
            <Field.Label margin={0}>Mapping</Field.Label>
          </HStack>
          <HStack gap={2}>
            <Text fontSize="sm">Traces</Text>
            <Switch
              checked={isThreadMapping}
              onCheckedChange={(e) => setIsThreadMapping(e.checked)}
            />
            <HStack gap={1}>
              <Text fontSize="sm">Threads</Text>
              {isThreadMapping && (
                <>
                  {threadIds.length === 0 ? (
                    <Badge colorPalette="gray" size="sm">
                      No threads found
                    </Badge>
                  ) : threadTraces.isLoading || threadTraces.isFetching ? (
                    <Spinner size="xs" />
                  ) : threadTraces.isError ? (
                    <Badge colorPalette="red" size="sm">
                      Error loading traces
                    </Badge>
                  ) : threadTraces.data ? (
                    <Badge colorPalette="blue" size="sm">
                      {threadTraces.data.length} traces
                    </Badge>
                  ) : null}
                </>
              )}
            </HStack>
          </HStack>
          <Field.HelperText margin={0} fontSize="13px" marginBottom={2}>
            {isThreadMapping
              ? "Map the thread data to the dataset columns (groups traces by thread_id)"
              : "Map the trace data to the dataset columns"}
          </Field.HelperText>

          {isThreadMapping ? (
            <ThreadMapping
              traces={tracesToUse}
              threadMapping={currentThreadMapping}
              targetFields={columnTypes.map(({ name }) => name)}
              setDatasetEntries={onRowDataChange}
              setThreadMapping={debouncedUpdateThreadMapping}
            />
          ) : (
            <TracesMapping
              traceMapping={
                (selectedDataset.mapping as any)?.traceMapping ??
                (selectedDataset.mapping as MappingState | undefined)
              }
              traces={tracesToUse}
              targetFields={columnTypes.map(({ name }) => name)}
              setDatasetEntries={onRowDataChange}
              setTraceMapping={(newMappingState) => {
                setDatasetTriggerMapping?.(newMappingState);
                updateStoredMapping(newMappingState);
              }}
            />
          )}
        </VStack>
        <VStack align="start" width="full" height="full">
          <HStack width="full" align="end">
            <VStack align="start">
              <Field.Label margin={0}>Preview</Field.Label>
              <Field.HelperText margin={0} fontSize="13px">
                {paragraph
                  ? paragraph
                  : "Those are the rows that are going to be added, double click on the cell to edit them"}
              </Field.HelperText>
            </VStack>
            <Spacer />
            <Button
              size="sm"
              colorPalette="blue"
              variant="outline"
              onClick={onEditColumns}
            >
              <Edit2 height={16} /> Edit Columns
            </Button>
          </HStack>
          <Box width="full" display="block" paddingTop={2}>
            <ErrorBoundary
              fallback={
                <Center width="full" height="full">
                  Error rendering the dataset, please refresh the page
                </Center>
              }
              onError={(error) => {
                console.error(error);
              }}
            >
              <DatasetGrid
                columnDefs={columnDefs}
                rowData={rowData}
                onCellValueChanged={({
                  data,
                }: {
                  data: DatasetRecordEntry;
                }) => {
                  onRowDataChange(
                    rowData.map((row) => (row.id === data.id ? data : row))
                  );
                }}
              />
            </ErrorBoundary>
          </Box>
        </VStack>
      </HStack>
    </Field.Root>
  );
}
