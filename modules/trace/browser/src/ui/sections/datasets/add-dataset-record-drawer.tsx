/**
 * "Add to Dataset": pick a dataset, map the trace onto its columns, add the rows.
 */

import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { useEffect, useMemo, useRef, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";

import { useAnnotationQueueSessionStore } from "../../../behavior/annotation-queue-session.store.ts";
import { useDatasets } from "../../../behavior/reads/use-project-reads.ts";
import { useTracesWithSpans } from "../../../behavior/reads/use-trace-mapping-reads.ts";
import { useLocalStorageSelectedDataSetId } from "../../../behavior/use-local-storage-selected-dataset-id.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import {
  useCreateDatasetRecord,
  useInvalidateDatasets,
} from "../../../behavior/writes/use-trace-writes.ts";
import { Drawer } from "../drawer.tsx";
import { showErrorToast } from "../errors/index.ts";
import { DatasetMappingPreview } from "./dataset-mapping-preview.tsx";
import { DatasetSelector } from "./dataset-selector.tsx";

/** Form values for dataset selection */
type FormValues = {
  datasetId: string;
};

interface AddDatasetRecordDrawerProps {
  /** Callback function called on successful record addition */
  onSuccess?: () => void;
  /** ID of the trace to add */
  traceId?: string;
  /**
   * The traces a bulk selection is adding.
   */
  selectedTraceIds?: string[] | string;
}

/** The traces a bulk selection or a single trace is adding, blanks dropped. */
function traceIdsOf({
  selectedTraceIds,
  traceId,
}: {
  selectedTraceIds: string[] | string | undefined;
  traceId: string | undefined;
}): string[] {
  const selected = Array.isArray(selectedTraceIds) ? selectedTraceIds : [selectedTraceIds];
  return [...selected, traceId].filter((id): id is string => !!id);
}

/**
 * A cell as its column stores it. Anything but a `string` column holds JSON,
 * read back out of the string the editor holds; text that is not JSON stays text.
 */
function cellValue({ value, columnType }: { value: unknown; columnType: string | undefined }) {
  if (columnType === "string" || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** The selected rows as dataset entries, without the selection flag. */
function entriesToAdd({
  rows,
  columnTypes,
}: {
  rows: DatasetRecordEntry[];
  columnTypes: DatasetColumns | undefined;
}): DatasetRecordEntry[] {
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => key !== "selected")
          .map(([key, value]) => [
            key,
            cellValue({ value, columnType: columnTypes?.find((c) => c.name === key)?.type }),
          ]),
      ) as DatasetRecordEntry,
  );
}

function isScrolledToBottom(el: HTMLElement): boolean {
  return el.scrollTop >= el.scrollHeight - el.clientHeight;
}

function submitLabel({ rowCount, isReady }: { rowCount: number; isReady: boolean }): string {
  if (!isReady) return "Add  to dataset";
  return `Add ${rowCount} ${rowCount === 1 ? "row" : "rows"} to dataset`;
}

function toastAddedToDataset({
  projectSlug,
  datasetId,
}: {
  projectSlug: string | undefined;
  datasetId: string;
}) {
  toaster.create({
    title: "Successfully added to dataset",
    description: (
      <RoutedLink
        href={`/${projectSlug}/datasets/${datasetId}`}
        style={{ color: "white", textDecoration: "underline" }}
      >
        View the dataset
      </RoutedLink>
    ),
    type: "success",
  });
}

export function AddDatasetRecordDrawer(props: AddDatasetRecordDrawerProps) {
  const invalidateDatasets = useInvalidateDatasets();
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = useCreateDatasetRecord();
  // Leaving this drawer hands the reader back to whatever opened it, the
  // trace they were reading say, rather than clearing the page. Opened with
  // nothing underneath (a bulk selection, the end-of-queue hand-off), going
  // back closes the drawer outright.
  const { goBack, openDrawer } = useDrawer();

  // Selected Dataset ID - Local Storage
  const {
    selectedDataSetId: localStorageDatasetId,
    setSelectedDataSetId: setLocalStorageDatasetId,
    rememberCreatedDataset,
  } = useLocalStorageSelectedDataSetId();

  const {
    handleSubmit,
    reset,
    watch,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      datasetId: localStorageDatasetId,
    },
  });

  const datasetId = watch("datasetId");
  const datasets = useDatasets({ projectId: project?.id });

  const selectedDataset = datasets.data?.find((dataset) => dataset.id === datasetId);

  const traceIds = useMemo(
    () => traceIdsOf({ selectedTraceIds: props.selectedTraceIds, traceId: props.traceId }),
    [props.selectedTraceIds, props.traceId],
  );

  // Fetch traces with spans data. Reviewer corrections apply here so a dataset
  // record carries exactly what the reviewer corrected.
  const tracesWithSpans = useTracesWithSpans({
    projectId: project?.id,
    traceIds,
    withEditOverlay: true,
  });

  // Dataset's editor is its own routed drawer: go there, and come back to the dataset it saved.
  const openDatasetEditor = () =>
    openDrawer("addOrEditDataset", {
      ...(selectedDataset
        ? {
            datasetToSave: {
              datasetId,
              name: selectedDataset.name ?? "",
              columnTypes: selectedDataset.columnTypes ?? [],
            },
          }
        : {}),
      onSuccess: (saved) => {
        rememberCreatedDataset(saved.datasetId);
        invalidateDatasets();
      },
      onClose: goBack,
    });

  const handleOnClose = () => {
    goBack();
    reset();
  };

  // State for editable row data
  const [editableRowData, setEditableRowData] = useState<DatasetRecordEntry[]>([]);
  const rowsToAdd = editableRowData.filter((row) => row.selected);
  const columnTypes = selectedDataset?.columnTypes;

  const onSubmit: SubmitHandler<FormValues> = async (_data) => {
    if (!selectedDataset || !project) return;

    const entries = entriesToAdd({ rows: rowsToAdd, columnTypes });

    await createDatasetRecord.mutateAsync(
      {
        projectId: project.id ?? "",
        datasetId: datasetId,
        entries,
      },
      {
        onSuccess: () => {
          // Whoever opened the drawer gets told the records landed, so a flow
          // that led here can finish itself off.
          props.onSuccess?.();
          // The annotation queue's hand-off is the one flow whose next step
          // outlives this drawer: the walk is over, and the celebration it
          // crowns waits on the records actually landing.
          const session = useAnnotationQueueSessionStore.getState();
          if (session.active) session.noteHandoffAdded();
          goBack();
          toastAddedToDataset({ projectSlug: project?.slug, datasetId });
        },
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: "Failed to add to the dataset",
            description: "Please check if the rows were not already inserted in the dataset",
          });
        },
      },
    );

    // We do this here since if we do it before, or attempt to do keep the
    // datasetId in sync, it will force a re-render and the drawers will close.
    await setLocalStorageDatasetId(_data.datasetId);
  };

  // State for row data from dataset
  const [rowDataFromDataset, setRowDataFromDataset] = useState<DatasetRecordEntry[]>([]);

  // Update editable row data when dataset row data changes
  useEffect(() => {
    if (!rowDataFromDataset) return;

    setEditableRowData(rowDataFromDataset);
  }, [rowDataFromDataset]);

  // Scroll position tracking
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorPortalRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    if (scrollRef.current) setAtBottom(isScrolledToBottom(scrollRef.current));
  }, [rowDataFromDataset]);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="xl"
      onOpenChange={({ open }) => {
        if (!open) {
          handleOnClose();
        }
      }}
      onEscapeKeyDown={(e) => {
        // Escape while the floating cell editor is open should only close
        // the editor (its own handler), never the whole drawer.
        if (editorPortalRef.current?.querySelector("[data-floating-cell-editor]")) {
          e.preventDefault();
        }
      }}
      preventScroll={true}
    >
      <Drawer.Content
        bg="bg"
        maxWidth="1400px"
        overflow="auto"
        ref={scrollRef}
        onScroll={(e) => setAtBottom(isScrolledToBottom(e.currentTarget))}
      >
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="3xl">
              Add to Dataset
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body overflow="visible" paddingX={0} ref={editorPortalRef}>
          <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
            <VStack paddingX={6}>
              <DatasetSelector
                isLoading={datasets.isLoading}
                isError={datasets.isError}
                datasets={datasets.data}
                localStorageDatasetId={datasetId}
                errors={errors}
                setValue={setValue}
                onCreateNew={openDatasetEditor}
              />
              {selectedDataset && (
                <DatasetMappingPreview
                  traces={tracesWithSpans.data ?? []}
                  columnTypes={selectedDataset.columnTypes}
                  rowData={rowDataFromDataset}
                  selectedDataset={selectedDataset}
                  onEditColumns={openDatasetEditor}
                  onRowDataChange={setRowDataFromDataset}
                  editorPortalRef={editorPortalRef}
                />
              )}
            </VStack>

            <HStack
              width="full"
              justifyContent="flex-end"
              position="sticky"
              bottom={0}
              paddingBottom={4}
              background="bg.panel"
              transition="box-shadow 0.3s ease-in-out"
              boxShadow={atBottom ? "none" : "0 -2px 5px rgba(0, 0, 0, 0.1)"}
              paddingX={6}
            >
              <Button
                type="submit"
                colorPalette="blue"
                marginTop={6}
                marginBottom={4}
                loading={createDatasetRecord.isPending}
                disabled={!selectedDataset || !tracesWithSpans.data || rowsToAdd.length === 0}
              >
                {submitLabel({
                  rowCount: rowsToAdd.length,
                  isReady: !!selectedDataset && !!tracesWithSpans.data,
                })}
              </Button>
            </HStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
