import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Heading,
  HStack,
  Spacer,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import Parse from "papaparse";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronDown,
  Download,
  Edit2,
  Play,
  Plus,
  Upload,
} from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useDrawer } from "../CurrentDrawer";
import {
  DatasetGrid,
  datasetValueToGridValue,
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./DatasetGrid";

import type { AgGridReact } from "@ag-grid-community/react";
import { nanoid } from "nanoid";
import { datasetDatabaseRecordsToInMemoryDataset } from "../../optimization_studio/utils/datasetUtils";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import { AddOrEditDatasetDrawer } from "../AddOrEditDatasetDrawer";
import { AddRowsFromCSVModal } from "./AddRowsFromCSVModal";

import { toaster } from "../ui/toaster";
import { Menu } from "../ui/menu";
import { ErrorBoundary } from "react-error-boundary";

export type InMemoryDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: DatasetRecordEntry[];
  columnTypes: DatasetColumns;
};

export const DEFAULT_DATASET_NAME = "Draft Dataset";

export function DatasetTable({
  datasetId: datasetId_,
  inMemoryDataset,
  onUpdateDataset,
  isEmbedded = false,
  insideWizard = false,
  title,
  hideButtons = false,
  bottomSpace = "300px",
  loadingOverlayComponent,
  gridRef: parentGridRef,
  canEditDatasetRecord = true,
}: {
  datasetId?: string;
  inMemoryDataset?: InMemoryDataset;
  onUpdateDataset?: (dataset: InMemoryDataset & { datasetId?: string }) => void;
  isEmbedded?: boolean;
  insideWizard?: boolean;
  title?: string;
  hideButtons?: boolean;
  bottomSpace?: string;
  loadingOverlayComponent?: (() => React.ReactNode) | null;
  gridRef?: RefObject<AgGridReact<any> | null>;
  /**
   * Whether the user can edit the dataset records in the database.
   * Generally disabled when you want to force InMemoryDataset only mode.
   * This disables the "Edit Columns" button and the edit dataset drawer.
   */
  canEditDatasetRecord?: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  const { openDrawer } = useDrawer();
  const addRowsFromCSVModal = useDisclosure();
  const editDataset = useDisclosure();
  const [savingStatus, setSavingStatus] = useState<"saving" | "saved" | "">("");

  const [datasetId, setDatasetId] = useState<string | undefined>(datasetId_);
  useEffect(() => {
    setDatasetId(datasetId_);
  }, [datasetId_]);
  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
      onError: (error) => {
        toaster.create({
          title: "Error fetching dataset",
          description: error.message,
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
      },
    }
  );

  const dataset = useMemo(
    () =>
      databaseDataset.data
        ? datasetDatabaseRecordsToInMemoryDataset(databaseDataset.data)
        : inMemoryDataset,
    // Do not update for parent inMemoryDataset updates on purpose, only on network data load, keep local state local and sync manually to avoid rerenders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [databaseDataset.data]
  );
  const deleteDatasetRecord = api.datasetRecord.deleteMany.useMutation();
  const downloadDataset = api.datasetRecord.download.useMutation();

  const gridRef = useRef<AgGridReact>(null);

  const [columnTypes, setColumnTypes] = useState<DatasetColumns>(
    dataset?.columnTypes ?? []
  );
  useEffect(() => {
    setColumnTypes(dataset?.columnTypes ?? []);
  }, [dataset?.columnTypes]);
  const columnDefs = useMemo(() => {
    const headers: DatasetColumnDef[] = columnTypes.map(({ name, type }) => ({
      headerName: name,
      field: name,
      type_: type,
      cellClass: "v-align",
      sortable: false,
      minWidth: 200,
    }));

    // Add row number column
    headers.unshift({
      headerName: "#",
      valueGetter: "node.rowIndex + 1",
      type_: "number",
      initialWidth: 48,
      pinned: "left",
      sortable: false,
      filter: false,
      editable: false,
    });

    // Add select column
    headers.unshift({
      headerName: "",
      field: "selected",
      type_: "boolean",
      width: 46,
      pinned: "left",
      sortable: false,
      filter: false,
      editable: true,
      enableCellChangeFlash: false,
      headerComponent: HeaderCheckboxComponent,
    });

    return headers;
  }, [columnTypes]);

  const [parentRowData, setParentRowData_] = useState<
    DatasetRecordEntry[] | undefined
  >();

  // Sync the in-memory dataset with the editable row data
  const setParentRowData = useCallback(
    (
      callback: (
        rows: DatasetRecordEntry[] | undefined
      ) => DatasetRecordEntry[] | undefined
    ) => {
      if (datasetId) return;
      setParentRowData_((rows) => {
        const rows_ = callback(rows);
        onUpdateDataset?.({
          datasetId: datasetId,
          name: dataset?.name,
          datasetRecords: rows_ ?? [],
          columnTypes: columnTypes,
        });
        return rows_;
      });
    },
    [columnTypes, dataset?.name, datasetId, onUpdateDataset]
  );

  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set()
  );

  const [localRowData, setLocalRowData] = useState<
    DatasetRecordEntry[] | undefined
  >(undefined);
  useEffect(() => {
    if (!dataset?.datasetRecords) {
      setLocalRowData(undefined);
      return;
    }

    const rowData = dataset.datasetRecords.map((record) => {
      const row: DatasetRecordEntry = { id: record.id };
      columnTypes.forEach((col) => {
        const value = record[col.name];
        row[col.name] = datasetValueToGridValue(value, col.type);
      });
      row.selected = selectedEntryIds.has(record.id);
      return row;
    });

    setLocalRowData(rowData);
    setParentRowData((_) => rowData);
    // We disable local row updates for selectedEntryIds and setParentRowData, since we don't want to rerender for a simple callback change nor for selection inside ag-grid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnTypes, dataset?.datasetRecords]);

  const downloadCSV = async (selectedOnly = false) => {
    let data: InMemoryDataset | undefined;
    if (databaseDataset.data && !selectedOnly) {
      const dataset = await downloadDataset.mutateAsync({
        projectId: project?.id ?? "",
        datasetId: datasetId ?? "",
      });

      if (dataset?.datasetRecords) {
        data = datasetDatabaseRecordsToInMemoryDataset(dataset);
      }
    } else {
      data = dataset;
    }

    if (!data) {
      toaster.create({
        title: "Error downloading dataset",
        description: "Please try again",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      return;
    }

    const csvData =
      data.datasetRecords
        .filter((record) =>
          selectedOnly ? selectedEntryIds.has(record.id) : true
        )
        .map((record) =>
          columnTypes.map((col) => {
            const value = record[col.name];
            return datasetValueToGridValue(value, col.type);
          })
        ) ?? [];

    const csv = Parse.unparse({
      fields: columnTypes.map((col) => col.name),
      data: csvData,
    });

    const url = window.URL.createObjectURL(new Blob([csv]));

    const link = document.createElement("a");
    link.href = url;
    const fileName = `${
      dataset?.name?.toLowerCase().replace(/ /g, "_") ?? "draft_dataset"
    }${selectedOnly ? "_selected" : ""}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const timeoutRef = useRef<NodeJS.Timeout>(null);

  const updateDatasetRecord = api.datasetRecord.update.useMutation();
  const onCellValueChanged = useCallback(
    (params: any) => {
      const updatedRecord = params.data;

      setSelectedEntryIds((selectedEntryIds) => {
        const selectedEntryIds_ = new Set(selectedEntryIds);
        if (params.data.selected) {
          selectedEntryIds_.add(params.data.id);
        } else {
          selectedEntryIds_.delete(params.data.id);
        }
        return selectedEntryIds_;
      });

      // Skip updates when just the line selection changes
      if (
        params.column.colId === "selected" &&
        params.column.pinned === "left"
      ) {
        return;
      }

      setParentRowData((rows) => {
        const currentIndex =
          rows?.findIndex((row) => row.id === params.data.id) ?? -1;
        if (currentIndex === -1) {
          return rows ? [...rows, updatedRecord] : [updatedRecord];
        } else {
          const newRows = rows ? [...rows] : [];
          newRows[currentIndex] = {
            ...newRows[currentIndex],
            ...updatedRecord,
          };
          return newRows;
        }
      });

      if (!datasetId) return;

      setSavingStatus("saving");
      updateDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId,
          recordId: params.data.id,
          updatedRecord,
        },
        {
          onSuccess: () => {
            setSavingStatus("saved");
            if (timeoutRef.current) {
              clearInterval(timeoutRef.current);
            }
            //@ts-ignore
            timeoutRef.current = setTimeout(() => {
              setSavingStatus("");
            }, 3000);
          },
          onError: () => {
            toaster.create({
              title: "Error updating record.",
              description: "Changes will be reverted, please try again",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            void databaseDataset.refetch();
            setSavingStatus("");
          },
        }
      );
    },
    [
      setParentRowData,
      datasetId,
      updateDatasetRecord,
      project?.id,
      databaseDataset,
    ]
  );

  const onDelete = useCallback(() => {
    if (confirm("Are you sure?")) {
      const recordIds = Array.from(selectedEntryIds);
      setParentRowData(
        (rows) => rows?.filter((row) => !recordIds.includes(row.id))
      );

      const grid = parentGridRef ?? gridRef;

      if (grid.current?.api) {
        grid.current.api.applyTransaction({
          remove: recordIds.map((id) => ({ id })),
        });
      }

      if (!datasetId) return;

      deleteDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId,
          recordIds,
        },
        {
          onSuccess: () => {
            setSelectedEntryIds(new Set());
            toaster.create({
              title: `${recordIds.length} records deleted`,
              type: "success",
              duration: 5000,
              meta: { closable: true },
            });
            databaseDataset
              .refetch()
              .then(() => {
                grid.current?.api.refreshCells();
              })
              .catch(() => {
                // ignore
              });
          },
          onError: () => {
            toaster.create({
              title: "Error deleting records.",
              description: "Changes will be reverted, please try again",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
            void databaseDataset.refetch();
          },
        }
      );
    }
  }, [
    selectedEntryIds,
    setParentRowData,
    parentGridRef,
    datasetId,
    deleteDatasetRecord,
    project?.id,
    databaseDataset,
  ]);

  const onAddNewRow = useCallback(() => {
    const grid = parentGridRef ?? gridRef;
    if (!grid.current?.api) return;

    // Create a new empty row
    const newRow: Record<string, any> = { id: nanoid() };
    columnDefs.forEach((col) => {
      if (col.field && col.field !== "selected") {
        newRow[col.field] = "";
      }
    });

    const firstEditableColumn = columnDefs.find(
      (col) => col.editable !== false && col.field !== "selected"
    );

    const result = grid.current.api.applyTransaction({ add: [newRow] });

    // Get the index of the newly added row
    const newRowIndex = result?.add[0]?.rowIndex ?? 0; // editableRowData.length;

    setTimeout(() => {
      // Find the first editable column
      if (!firstEditableColumn?.field) return;

      const focus = () => {
        // Start editing the first editable cell in the new row
        grid.current?.api.startEditingCell({
          rowIndex: newRowIndex,
          colKey: firstEditableColumn.field!,
        });
      };

      // Focus three times due to auto height adjusting layout reflow
      focus();
      if (dataset && dataset.datasetRecords.length > 100) {
        setTimeout(() => {
          focus();
        }, 1000);
        setTimeout(() => {
          focus();
        }, 1500);
      }
    }, 100);
  }, [columnDefs, dataset, parentGridRef]);

  return (
    <>
      <HStack width="full" verticalAlign={"middle"} paddingBottom={6} gap={6}>
        <HStack gap={2}>
          {insideWizard ? (
            <Heading as="h3" size="md" fontWeight="600">
              {dataset?.name ?? DEFAULT_DATASET_NAME}
            </Heading>
          ) : (
            <Heading as="h1" size="lg">
              {title ? (
                title
              ) : (
                <>
                  {isEmbedded ? "Edit Dataset" : "Dataset"}{" "}
                  {`- ${
                    dataset?.name
                      ? dataset.name
                      : datasetId
                      ? ""
                      : DEFAULT_DATASET_NAME
                  }`}
                </>
              )}
            </Heading>
          )}
          {canEditDatasetRecord && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => editDataset.onOpen()}
              minWidth="fit-content"
            >
              <Edit2 />
            </Button>
          )}
        </HStack>
        <Text fontSize={"14px"} color="gray.400">
          {databaseDataset.data?.count ?? parentRowData?.length} records
        </Text>
        <Text fontSize={"14px"} color="gray.400">
          {savingStatus === "saving"
            ? "Saving..."
            : savingStatus === "saved"
            ? "Saved"
            : ""}
        </Text>
        <Spacer />
        {!hideButtons && (
          <>
            {isEmbedded && (
              <Button
                colorPalette="gray"
                minWidth="fit-content"
                onClick={() =>
                  openDrawer("uploadCSV", {
                    onSuccess: ({ datasetId: datasetId_ }) => {
                      setDatasetId(datasetId_);
                      void databaseDataset.refetch();
                    },
                    onCreateFromScratch: () => {
                      openDrawer("addOrEditDataset", {
                        onSuccess: ({ datasetId: datasetId_ }) => {
                          setDatasetId(datasetId_);
                          void databaseDataset.refetch();
                        },
                      });
                    },
                  })
                }
              >
                <Upload height={17} width={17} strokeWidth={2.5} />
                Upload or Create Dataset
              </Button>
            )}
            {!insideWizard && (
              <Button
                colorPalette="gray"
                minWidth="fit-content"
                onClick={() => dataset && void downloadCSV()}
                loading={downloadDataset.isLoading}
                loadingText="Downloading..."
              >
                <Download />
                Export
              </Button>
            )}
            {canEditDatasetRecord && (
              <Button
                colorPalette="gray"
                onClick={() => editDataset.onOpen()}
                minWidth="fit-content"
              >
                <Edit2 />
                Edit Columns
              </Button>
            )}
            {datasetId && !isEmbedded && !insideWizard && (
              <Button
                colorPalette="blue"
                onClick={() => {
                  openDrawer("batchEvaluation", {
                    datasetSlug: databaseDataset.data?.slug,
                  });
                }}
                minWidth="fit-content"
              >
                <Play height={16} />
                Batch Evaluation
              </Button>
            )}
          </>
        )}
      </HStack>
      <Card.Root>
        <Card.Body padding={0} position="relative">
          <Box height={`calc(max(100vh - ${bottomSpace}, 500px))`}>
            {databaseDataset.data?.truncated && (
              <Alert.Root status="warning" variant="subtle">
                <Alert.Indicator />
                <Alert.Content>
                  This dataset is too large to display all records. Displaying
                  the first 5mb of data.
                </Alert.Content>
              </Alert.Root>
            )}
            <ErrorBoundary
              fallback={
                <Center width="full" height="full">
                  Error rendering the dataset, please refresh the page
                </Center>
              }
            >
              <DatasetGrid
                columnDefs={columnDefs}
                rowData={localRowData}
                onCellValueChanged={onCellValueChanged}
                ref={parentGridRef ?? gridRef}
                domLayout="normal"
                {...(loadingOverlayComponent !== undefined
                  ? { loadingOverlayComponent }
                  : {})}
              />
            </ErrorBoundary>
          </Box>
        </Card.Body>
      </Card.Root>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            position="sticky"
            left="0"
            bottom={isEmbedded ? "32px" : 6}
            marginTop={6}
            marginLeft={insideWizard ? 0 : 6}
            backgroundColor="#ffffff"
            padding="8px"
            paddingX="16px"
            border="1px solid #ccc"
            boxShadow="base"
            borderRadius="md"
            zIndex="100"
          >
            <Plus />
            Add new record
            <ChevronDown width={16} height={16} />
          </Button>
        </Menu.Trigger>
        <Menu.Content zIndex="popover">
          <Menu.Item
            value="import-csv"
            onClick={() => addRowsFromCSVModal.onOpen()}
          >
            <Upload height={16} width={16} /> Import from CSV
          </Menu.Item>
          <Menu.Item value="add-line" onClick={onAddNewRow}>
            <Plus height={16} width={16} /> Add new line
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <AddRowsFromCSVModal
        isOpen={addRowsFromCSVModal.open}
        onClose={addRowsFromCSVModal.onClose}
        datasetId={datasetId}
        columnTypes={columnTypes}
        onUpdateDataset={(entries) => {
          setParentRowData((currentEntries) => {
            if (!currentEntries) return entries;
            return [...currentEntries, ...entries];
          });
          setLocalRowData((currentEntries) => {
            if (!currentEntries) return entries;
            return [...currentEntries, ...entries];
          });
          addRowsFromCSVModal.onClose();
        }}
      />
      {selectedEntryIds.size > 0 && (
        <Box
          position="fixed"
          bottom={6}
          left="50%"
          transform="translateX(-50%)"
          backgroundColor="#ffffff"
          padding="8px"
          paddingX="16px"
          border="1px solid #ccc"
          boxShadow="base"
          borderRadius={"md"}
        >
          <HStack gap={3}>
            <Text>{selectedEntryIds.size} entries selected</Text>
            <Button
              colorPalette="black"
              minWidth="fit-content"
              variant="outline"
              onClick={() => void downloadCSV(true)}
            >
              Export <Upload style={{ marginLeft: "8px" }} />
            </Button>

            <Text>or</Text>
            <Button
              colorPalette="red"
              type="submit"
              variant="outline"
              minWidth="fit-content"
              onClick={onDelete}
            >
              Delete
            </Button>
          </HStack>
        </Box>
      )}
      {editDataset.open && (
        <AddOrEditDatasetDrawer
          datasetToSave={{
            datasetId,
            name: dataset?.name ?? "",
            datasetRecords: datasetId ? undefined : parentRowData,
            columnTypes,
          }}
          open={editDataset.open}
          onClose={editDataset.onClose}
          onSuccess={(updatedDataset) => {
            if (dataset?.datasetRecords) {
              onUpdateDataset?.({
                datasetId: updatedDataset.datasetId,
                name: updatedDataset.name,
                datasetRecords: dataset.datasetRecords,
                columnTypes: updatedDataset.columnTypes,
              });
            }
            setDatasetId(updatedDataset.datasetId);
            setColumnTypes(updatedDataset.columnTypes);
            void databaseDataset.refetch();
            editDataset.onClose();
          }}
        />
      )}
    </>
  );
}
