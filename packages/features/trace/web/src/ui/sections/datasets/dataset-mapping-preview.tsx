/**
 * The mapping half of the "Add to Dataset" drawer: which trace field fills
 * which dataset column, and what the rows will look like once it does.
 *
 * Recovered from `platform/app/src/components/datasets/DatasetMappingPreview.tsx`,
 * deleted in `cc91631cd8`. `TracesMapping` and `ThreadMapping` were already
 * this package's; the preview table is `@langwatch/dataset-web`'s and is read
 * through its own export rather than copied.
 */

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
import { DatasetPreviewTable } from "@langwatch/dataset-web/components/datasets/editor/DatasetPreviewTable";
import type { Dataset, DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { MappingState, Trace } from "@langwatch/trace-contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Edit2 } from "react-feather";

import { useDebouncedCallback } from "../../../behavior/use-debounced-callback";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { ThreadMapping, type ThreadMappingState } from "../traces/thread-mapping";
import { TracesMapping } from "../traces/traces-mapping";
import { api } from "../trace-api";

interface DatasetMappingPreviewProps {
  traces: Trace[];
  columnTypes: DatasetColumns;
  rowData: DatasetRecordEntry[];
  selectedDataset: Pick<Dataset, "id" | "columnTypes" | "mapping">;
  onEditColumns: () => void;
  onRowDataChange: (entries: DatasetRecordEntry[]) => void;
  paragraph?: string;
  setDatasetTriggerMapping?: (mapping: MappingState) => void;
  /** Portal target for the floating cell editor when hosted in a drawer. */
  editorPortalRef?: React.RefObject<HTMLDivElement | null>;
}

/** The two shapes a dataset's stored mapping can take on the wire. */
type StoredMapping = {
  traceMapping?: MappingState;
  threadMapping?: ThreadMappingState;
};

/**
 * Provide interface for mapping trace or thread data to dataset columns.
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
  editorPortalRef,
}: DatasetMappingPreviewProps) {
  const [isThreadMapping, setIsThreadMapping] = useState(false);
  const [, setThreadMappingState] = useState<ThreadMappingState>();

  const { project } = useOrganizationTeamProject();

  // The preview table's row contract is `isSelected`; entry rows keep the
  // wider `selected` field consumed by the add-to-dataset submit filter.
  const previewRows = useMemo(
    () => rowData.map((row) => ({ ...row, isSelected: !!row.selected })),
    [rowData],
  );

  // Extract thread_ids from traces
  const threadIds = useMemo(() => {
    const ids = traces.map((trace) => trace.metadata?.thread_id).filter((id): id is string => !!id);
    return Array.from(new Set(ids));
  }, [traces]);

  // Fetch all traces with matching thread_ids when thread mapping is enabled.
  // Corrections apply here too, so thread mode maps the corrected traces.
  const threadTraces = api.traces.getTracesWithSpansByThreadIds.useQuery(
    {
      projectId: project?.id ?? "",
      threadIds: threadIds,
      withEditOverlay: true,
    },
    {
      enabled: !!project && isThreadMapping && threadIds.length > 0,
      refetchOnWindowFocus: false,
    },
  );

  // Use thread traces when thread mapping is enabled, otherwise use provided traces
  const tracesToUse = useMemo(() => {
    if (isThreadMapping && threadTraces.data) {
      return threadTraces.data;
    }
    return traces;
  }, [isThreadMapping, threadTraces.data, traces]);

  const trpc = api.useUtils();
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
        },
      );
    },
    [selectedDataset.id, project?.id, trpc.dataset.getAll, updateStoredMapping_],
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
        },
      );
    },
    [selectedDataset.id, project?.id, trpc.dataset.getAll, updateStoredMapping_],
  );

  const debouncedUpdateThreadMapping = useDebouncedCallback(
    (newThreadMapping: ThreadMappingState) => {
      setThreadMappingState(newThreadMapping);
      updateStoredThreadMapping(newThreadMapping);
    },
    400,
  );

  // Clear thread mapping state and cancel pending updates when dataset changes
  useEffect(() => {
    setThreadMappingState(void 0);
    debouncedUpdateThreadMapping.cancel();
  }, [selectedDataset.id, debouncedUpdateThreadMapping]);

  const storedMapping = selectedDataset.mapping as StoredMapping | MappingState | null;

  // Get the current dataset's thread mapping
  const currentThreadMapping = useMemo(
    () => (storedMapping as StoredMapping | null)?.threadMapping,
    [storedMapping],
  );

  return (
    // Each heading gets a field of its own, holding nothing but its words. A
    // field describes one control and hands that control its id, so one wrapped
    // around this whole panel gave the same id to every expansion switch and
    // every preview checkbox under it, and a click on one went wherever the id
    // resolved first.
    <Box width="full" paddingY={4}>
      <HStack width="full" gap="64px" align="start">
        <VStack align="start" maxWidth="50%" gap={4}>
          <Field.Root width="full">
            <HStack width="full" align="center" justify="space-between">
              <Field.Label margin={0}>Mapping</Field.Label>
            </HStack>
          </Field.Root>
          <HStack bg="gray.100" _dark={{ bg: "gray.800" }} borderRadius="md" padding="3px" gap={0}>
            <Box
              as="button"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                setIsThreadMapping(false);
              }}
              bg={!isThreadMapping ? "white" : "transparent"}
              _dark={{
                bg: !isThreadMapping ? "gray.700" : "transparent",
              }}
              color={!isThreadMapping ? "fg" : "fg.muted"}
              fontWeight={!isThreadMapping ? "medium" : "normal"}
              borderRadius="sm"
              px={3}
              py={1}
              fontSize="sm"
              cursor="pointer"
              boxShadow={!isThreadMapping ? "xs" : "none"}
              transition="all 0.15s"
            >
              Current Trace
            </Box>
            <Box
              as="button"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                setIsThreadMapping(true);
              }}
              bg={isThreadMapping ? "white" : "transparent"}
              _dark={{
                bg: isThreadMapping ? "gray.700" : "transparent",
              }}
              color={isThreadMapping ? "fg" : "fg.muted"}
              fontWeight={isThreadMapping ? "medium" : "normal"}
              borderRadius="sm"
              px={3}
              py={1}
              fontSize="sm"
              cursor="pointer"
              boxShadow={isThreadMapping ? "xs" : "none"}
              transition="all 0.15s"
            >
              <HStack gap={1}>
                <Text>Thread</Text>
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
                        Error
                      </Badge>
                    ) : threadTraces.data ? (
                      <Badge colorPalette="blue" size="sm">
                        {threadTraces.data.length} traces
                      </Badge>
                    ) : null}
                  </>
                )}
              </HStack>
            </Box>
          </HStack>
          <Field.Root width="full">
            <Field.HelperText margin={0} fontSize="13px" marginBottom={2}>
              {isThreadMapping
                ? "Groups traces by thread and maps to dataset columns"
                : "Maps each trace individually to dataset columns"}
            </Field.HelperText>
          </Field.Root>

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
                (storedMapping as StoredMapping | null)?.traceMapping ??
                (storedMapping as MappingState | undefined) ??
                void 0
              }
              traces={tracesToUse}
              shouldApplyCorrections
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
            <Field.Root width="auto">
              <VStack align="start">
                <Field.Label margin={0}>Preview</Field.Label>
                <Field.HelperText margin={0} fontSize="13px">
                  {paragraph
                    ? paragraph
                    : "Those are the rows that are going to be added, double click a cell to edit it"}
                </Field.HelperText>
              </VStack>
            </Field.Root>
            <Spacer />
            <Button size="sm" colorPalette="blue" variant="outline" onClick={onEditColumns}>
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
            >
              <DatasetPreviewTable
                rows={previewRows}
                columns={selectedDataset.columnTypes ?? []}
                maxColumns={50}
                maxHeight="400px"
                isSelectable
                onToggleRow={(rowIndex, isSelected) => {
                  onRowDataChange(
                    rowData.map((row, index) =>
                      index === rowIndex ? { ...row, selected: isSelected } : row,
                    ),
                  );
                }}
                onToggleAll={(isSelected) => {
                  onRowDataChange(rowData.map((row) => ({ ...row, selected: isSelected })));
                }}
                onCellEdit={(rowIndex, columnName, value) => {
                  onRowDataChange(
                    rowData.map((row, index) =>
                      index === rowIndex ? { ...row, [columnName]: value } : row,
                    ),
                  );
                }}
                {...(editorPortalRef ? { editorPortalRef } : {})}
              />
            </ErrorBoundary>
          </Box>
        </VStack>
      </HStack>
    </Box>
  );
}
