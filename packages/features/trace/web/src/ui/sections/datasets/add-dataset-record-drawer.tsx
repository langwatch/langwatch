/**
 * "Add to Dataset": pick a dataset, map the trace onto its columns, add the
 * rows.
 *
 * Recovered from `platform/app/src/components/AddDatasetRecordDrawer.tsx`,
 * deleted in `cc91631cd8`. Three surfaces address it and none of them had
 * anything to open: the explorer's bulk-action bar, the trace drawer's overflow
 * menu and the annotation queue's end-of-walk hand-off.
 *
 * IT IS THE TRACE FAMILY'S DRAWER even though its subject is a dataset: what it
 * reads is traces with their spans, corrections applied, and what it renders is
 * this package's trace-to-column mapping. The dataset procedures it calls are
 * declared on this package's own map under the dataset family's segment names,
 * so the list it reads and the list the Datasets page reads are one cache entry.
 *
 * THE DATASET EDITOR IS INJECTED RATHER THAN IMPORTED. "+ Create New" and "Edit
 * Columns" open `@langwatch/dataset-web`'s editor, which runs on the STUDIO
 * host — a host the composing application mounts and a feature package may not.
 * It also cannot be navigated to the way `drawers.md` prescribes, because this
 * package's drawer navigator carries only what a URL can carry and the editor's
 * `onSuccess` is a function. So the application hands the editor in already
 * hosted, and a composition that supplies none simply does not offer the two
 * affordances rather than offering two dead ones.
 */

import { Button, HStack, Text, useDisclosure, VStack } from "@chakra-ui/react";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { createLogger } from "@langwatch/observability";
import { toaster } from "@langwatch/design-system/toaster";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";

import { useAnnotationQueueSessionStore } from "../../../behavior/annotation-queue-session.store";
import { useDrawer } from "../../../behavior/use-drawer";
import { useLocalStorageSelectedDataSetId } from "../../../behavior/use-local-storage-selected-dataset-id";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import NextLink from "../../elements/next-link";
import { Drawer } from "../drawer";
import { showErrorToast } from "../errors";
import { api } from "../trace-api";
import { DatasetMappingPreview } from "./dataset-mapping-preview";
import { DatasetSelector } from "./dataset-selector";

const logger = createLogger("AddDatasetRecordDrawer");

/** Form values for dataset selection */
type FormValues = {
  datasetId: string;
};

/**
 * The dataset editor this drawer leads to, as the application hands it over.
 *
 * The shape is `@langwatch/dataset-web`'s `AddOrEditDatasetDrawer`, narrowed to
 * what this caller passes.
 */
export type DatasetEditorComponent = ComponentType<{
  datasetToSave?: {
    datasetId?: string;
    /** Optional to match the editor's own `InMemoryDataset` shape. */
    name?: string;
    columnTypes: DatasetColumns;
    datasetRecords?: Array<{ id?: string } & Record<string, unknown>>;
  };
  open?: boolean;
  onClose?: () => void;
  /**
   * OPTIONAL, MATCHING THE EDITOR'S OWN PROP. The editor is a registered drawer
   * as well as a component, and an address cannot carry a function, so it
   * declares `onSuccess` optional and calls it only when one arrived. Requiring
   * it here would make the real editor unassignable to this slot: `ComponentType`
   * admits a class component, whose props are invariant, so a required callback
   * on this side rejects an optional one on that side. This caller always passes
   * one.
   */
  onSuccess?: (dataset: { datasetId: string; name: string; columnTypes: DatasetColumns }) => void;
}>;

export interface AddDatasetRecordDrawerProps {
  /** Callback function called on successful record addition */
  onSuccess?: () => void;
  /** ID of the trace to add */
  traceId?: string;
  /**
   * The traces a bulk selection is adding.
   *
   * A single id survives the address bar as a bare string rather than a
   * one-element list, so both spellings are accepted.
   */
  selectedTraceIds?: string[] | string;
  /** The hosted dataset editor, when the application composed one. */
  DatasetEditor?: DatasetEditorComponent;
}

export function AddDatasetRecordDrawer(props: AddDatasetRecordDrawerProps) {
  const trpc = api.useUtils();
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = api.datasetRecord.create.useMutation();
  const editDataset = useDisclosure();
  const DatasetEditor = props.DatasetEditor;
  // Leaving this drawer hands the reader back to whatever opened it, the
  // trace they were reading say, rather than clearing the page. Opened with
  // nothing underneath (a bulk selection, the end-of-queue hand-off), going
  // back closes the drawer outright.
  const { goBack } = useDrawer();

  // Selected Dataset ID - Local Storage
  const {
    selectedDataSetId: localStorageDatasetId,
    setSelectedDataSetId: setLocalStorageDatasetId,
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
  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false },
  );

  const selectedDataset = datasets.data?.find((dataset) => dataset.id === datasetId);

  // Combine trace IDs from props into a single array
  const traceIds = useMemo(
    () =>
      [
        ...(Array.isArray(props.selectedTraceIds)
          ? props.selectedTraceIds
          : [props.selectedTraceIds]),
        props?.traceId ?? "",
      ].filter(Boolean) as string[],
    [props.selectedTraceIds, props.traceId],
  );

  // Fetch traces with spans data. Reviewer corrections apply here so a dataset
  // record carries exactly what the reviewer corrected.
  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds,
      withEditOverlay: true,
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    },
  );

  const onCreateDatasetSuccess = ({ datasetId }: { datasetId: string }) => {
    void datasets
      .refetch()
      .then(() => {
        setTimeout(() => {
          setValue("datasetId", datasetId);
        }, 100);
      })
      .catch((error) => {
        logger.error({ error });
      });
  };

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

    // Transform row data into dataset entries
    const entries: DatasetRecordEntry[] = rowsToAdd.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([key, _]) => key !== "selected")
            .map(([key, value]) => {
              const column = columnTypes?.find((column) => column.name === key);
              // A cell holds one column's value, not a record: anything but a
              // `string` column stores JSON, so it is read back out of the
              // string the editor holds.
              let entry: unknown = value;
              if (column?.type !== "string" && typeof value === "string") {
                try {
                  entry = JSON.parse(value);
                } catch {
                  /* this is just a safe json parse fallback */
                }
              }

              return [key, entry];
            }),
        ) as DatasetRecordEntry,
    );

    await createDatasetRecord.mutateAsync(
      {
        projectId: project.id ?? "",
        datasetId: datasetId,
        entries,
      },
      {
        onSuccess: () => {
          void trpc.dataset.getAll.invalidate();
          void trpc.datasetRecord.getAll.invalidate();
          // Whoever opened the drawer gets told the records landed, so a flow
          // that led here can finish itself off.
          props.onSuccess?.();
          // The annotation queue's hand-off is the one flow whose next step
          // outlives this drawer: the walk is over, and the celebration it
          // crowns waits on the records actually landing.
          const session = useAnnotationQueueSessionStore.getState();
          if (session.active) session.noteHandoffAdded();
          goBack();
          toaster.create({
            title: "Successfully added to dataset",
            description: (
              <NextLink
                href={`/${project?.slug}/datasets/${datasetId}`}
                style={{ color: "white", textDecoration: "underline" }}
              >
                View the dataset
              </NextLink>
            ),
            type: "success",
          });
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
    if (!scrollRef.current) return;

    setAtBottom(
      (scrollRef.current.scrollTop ?? 0) >=
        (scrollRef.current.scrollHeight ?? 0) - (scrollRef.current.clientHeight ?? 0),
    );
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
        onScroll={() =>
          setAtBottom(
            (scrollRef.current?.scrollTop ?? 0) >=
              (scrollRef.current?.scrollHeight ?? 0) - (scrollRef.current?.clientHeight ?? 0),
          )
        }
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
                {...(DatasetEditor ? { onCreateNew: editDataset.onOpen } : {})}
              />
              {selectedDataset && (
                <DatasetMappingPreview
                  traces={tracesWithSpans.data ?? []}
                  columnTypes={selectedDataset.columnTypes}
                  rowData={rowDataFromDataset}
                  selectedDataset={selectedDataset}
                  onEditColumns={editDataset.onOpen}
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
                Add{" "}
                {selectedDataset && tracesWithSpans.data
                  ? `${rowsToAdd.length} ${rowsToAdd.length == 1 ? "row" : "rows"}`
                  : ""}{" "}
                to dataset
              </Button>
            </HStack>
          </form>
        </Drawer.Body>
      </Drawer.Content>
      {DatasetEditor && (
        <DatasetEditor
          {...(selectedDataset
            ? {
                datasetToSave: {
                  datasetId,
                  name: selectedDataset.name ?? "",
                  columnTypes: selectedDataset.columnTypes ?? [],
                },
              }
            : {})}
          open={editDataset.open}
          onClose={editDataset.onClose}
          onSuccess={onCreateDatasetSuccess}
        />
      )}
    </Drawer.Root>
  );
}
