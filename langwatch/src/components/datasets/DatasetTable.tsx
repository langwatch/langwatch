import { DownloadIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  HStack,
  Heading,
  Spacer,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import Parse from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Edit2, Play, Plus, Save, Upload } from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { useDrawer } from "../CurrentDrawer";
import {
  DatasetGrid,
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./DatasetGrid";

import type {
  AgGridReact,
  CustomCellRendererProps,
} from "@ag-grid-community/react";
import { nanoid } from "nanoid";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import { UploadCSVModal } from "./UploadCSVModal";
import { AddOrEditDatasetDrawer } from "../AddOrEditDatasetDrawer";

export type InMemoryDataset = {
  name?: string;
  datasetRecords: DatasetRecordEntry[];
  columnTypes: DatasetColumns;
};

export function DatasetTable({
  datasetId,
  inMemoryDataset,
  onUpdateDataset,
  isEmbedded = false,
}: {
  datasetId?: string;
  inMemoryDataset?: InMemoryDataset;
  onUpdateDataset?: (dataset: InMemoryDataset & { datasetId?: string }) => void;
  isEmbedded?: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  const { openDrawer } = useDrawer();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const editDataset = useDisclosure();
  const [savingStatus, setSavingStatus] = useState<"saving" | "saved" | "">("");

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );
  const dataset = useMemo(
    () => databaseDataset.data ?? inMemoryDataset,
    [databaseDataset.data, inMemoryDataset]
  );
  const deleteDatasetRecord = api.datasetRecord.deleteMany.useMutation();

  const gridRef = useRef<AgGridReact>(null);

  const columnTypes = useMemo(
    () => (dataset?.columnTypes as DatasetColumns) ?? [],
    [dataset]
  );
  const columnDefs = useMemo(() => {
    const headers: DatasetColumnDef[] = columnTypes.map(({ name, type }) => ({
      headerName: name,
      field: name,
      type_: type,
      cellClass: "v-align",
      sortable: false,
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
      editable: false,
      enableCellChangeFlash: false,
      headerComponent: HeaderCheckboxComponent,
      cellRenderer: (props: CustomCellRendererProps) => (
        <Checkbox
          marginLeft="3px"
          {...props}
          isChecked={props.value}
          onChange={(e) => props.setValue?.(e.target.checked)}
        />
      ),
    });

    return headers;
  }, [columnTypes]);

  const [editableRowData, setEditableRowData_] = useState<
    DatasetRecordEntry[] | undefined
  >();

  // Sync the in-memory dataset with the editable row data
  const setEditableRowData = useCallback(
    (
      callback: (
        rows: DatasetRecordEntry[] | undefined
      ) => DatasetRecordEntry[] | undefined
    ) => {
      setEditableRowData_((rows) => {
        const rows_ = callback(rows);
        onUpdateDataset?.({
          name: dataset?.name,
          datasetRecords: rows_ ?? [],
          columnTypes: columnTypes,
        });
        return rows_;
      });
    },
    [columnTypes, dataset?.name, onUpdateDataset]
  );

  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set()
  );

  const rowData = useMemo(() => {
    if (!dataset) return;

    const columns = (dataset.columnTypes as DatasetColumns).map(
      ({ name }) => name
    );
    return dataset.datasetRecords.map((record) => {
      const row: DatasetRecordEntry = { id: record.id };
      columns.forEach((col) => {
        const value = datasetId
          ? record.entry[col]
          : (record as DatasetRecordEntry)[col];
        row[col] = typeof value === "object" ? JSON.stringify(value) : value;
      });
      row.selected = selectedEntryIds.has(record.id);
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  useEffect(() => {
    if (!rowData) return;

    setEditableRowData((_) =>
      rowData.map((row) => ({
        ...row,
        selected: selectedEntryIds.has(row.id),
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rowData]);

  const toast = useToast();

  const downloadCSV = (selectedOnly = false) => {
    const columns = ((dataset?.columnTypes as DatasetColumns) ?? []).map(
      ({ name }) => name
    );
    const csvData =
      dataset?.datasetRecords
        .filter((record) =>
          selectedOnly ? selectedEntryIds.has(record.id) : true
        )
        .map((record) =>
          columns.map((col) => {
            const value = datasetId
              ? record.entry[col]
              : (record as DatasetRecordEntry)[col];
            return typeof value === "object" ? JSON.stringify(value) : value;
          })
        ) ?? [];

    const csv = Parse.unparse({
      fields: columns,
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

      setEditableRowData((rows) => {
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
            toast({
              title: "Error updating record.",
              description: "Changes will be reverted, please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            void databaseDataset.refetch();
            setSavingStatus("");
          },
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id]
  );

  const onDelete = useCallback(() => {
    if (confirm("Are you sure?")) {
      const recordIds = Array.from(selectedEntryIds);
      setEditableRowData(
        (rows) => rows?.filter((row) => !recordIds.includes(row.id))
      );

      if (gridRef.current?.api) {
        gridRef.current.api.applyTransaction({
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
            toast({
              title: `${recordIds.length} records deleted`,
              status: "success",
              duration: 5000,
              isClosable: true,
            });
            databaseDataset
              .refetch()
              .then(() => {
                gridRef.current?.api.refreshCells();
              })
              .catch(() => {
                // ignore
              });
          },
          onError: () => {
            toast({
              title: "Error deleting records.",
              description: "Changes will be reverted, please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            void databaseDataset.refetch();
          },
        }
      );
    }
  }, [
    selectedEntryIds,
    setEditableRowData,
    datasetId,
    deleteDatasetRecord,
    project?.id,
    toast,
    databaseDataset,
  ]);

  const onAddNewRow = useCallback(() => {
    if (!gridRef.current?.api) return;

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

    const result = gridRef.current.api.applyTransaction({ add: [newRow] });

    // Get the index of the newly added row
    const newRowIndex = result?.add[0]?.rowIndex ?? 0; // editableRowData.length;

    setTimeout(() => {
      // Find the first editable column
      if (firstEditableColumn?.field) {
        // Start editing the first editable cell in the new row
        gridRef.current?.api.startEditingCell({
          rowIndex: newRowIndex,
          colKey: firstEditableColumn.field,
        });
      }
    }, 100);
  }, [columnDefs]);

  return (
    <>
      <HStack
        width="full"
        verticalAlign={"middle"}
        paddingBottom={6}
        spacing={6}
      >
        <Heading as={"h1"} size="lg">
          {isEmbedded ? "Edit Dataset" : "Dataset"}{" "}
          {`- ${
            dataset?.name ? dataset.name : datasetId ? "" : "Draft Dataset"
          }`}
        </Heading>
        <Text fontSize={"14px"} color="gray.400">
          {editableRowData?.length} records
        </Text>
        <Text fontSize={"14px"} color="gray.400">
          {savingStatus === "saving"
            ? "Saving..."
            : savingStatus === "saved"
            ? "Saved"
            : ""}
        </Text>
        <Spacer />
        <Button
          onClick={() => onOpen()}
          rightIcon={<Upload height={17} width={17} strokeWidth={2.5} />}
        >
          Add from CSV
        </Button>
        <Button
          colorScheme="black"
          minWidth="fit-content"
          variant="ghost"
          onClick={() => dataset && downloadCSV()}
        >
          Export <DownloadIcon marginLeft={2} />
        </Button>
        {datasetId ? (
          <Button
            colorScheme="gray"
            onClick={() => editDataset.onOpen()}
            minWidth="fit-content"
            leftIcon={<Edit2 height={16} />}
          >
            Edit Dataset
          </Button>
        ) : (
          <Button
            colorScheme="blue"
            onClick={() => editDataset.onOpen()}
            minWidth="fit-content"
            leftIcon={<Save height={16} />}
          >
            Save
          </Button>
        )}
        {datasetId && !isEmbedded && (
          <Button
            colorScheme="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                datasetSlug: databaseDataset.data?.slug,
              });
            }}
            minWidth="fit-content"
            leftIcon={<Play height={16} />}
          >
            Batch Evaluation
          </Button>
        )}
      </HStack>
      <Card>
        <CardBody padding={0} position="relative">
          <DatasetGrid
            columnDefs={columnDefs}
            rowData={rowData}
            onCellValueChanged={onCellValueChanged}
            ref={gridRef}
          />
        </CardBody>
      </Card>
      <Button
        position="sticky"
        left="0"
        bottom={isEmbedded ? "32px" : 6}
        marginTop={6}
        marginLeft={6}
        backgroundColor="#ffffff"
        padding="8px"
        paddingX="16px"
        border="1px solid #ccc"
        boxShadow="base"
        borderRadius={"md"}
        onClick={onAddNewRow}
        zIndex="100"
      >
        <Plus />
        <Text>Add new record</Text>
      </Button>
      <UploadCSVModal
        isOpen={isOpen}
        onClose={onClose}
        datasetId={datasetId}
        columnTypes={columnTypes}
        onUpdateDataset={(entries) => {
          setEditableRowData((_) => entries);
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
              colorScheme="black"
              minWidth="fit-content"
              variant="outline"
              onClick={() => void downloadCSV(true)}
            >
              Export <DownloadIcon marginLeft={2} />
            </Button>

            <Text>or</Text>
            <Button
              colorScheme="red"
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
      {editDataset.isOpen && (
        <AddOrEditDatasetDrawer
          editDataset={{
            datasetId,
            name: dataset?.name ?? "",
            columnTypes,
          }}
          isOpen={editDataset.isOpen}
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
            void databaseDataset.refetch();
            editDataset.onClose();
          }}
        />
      )}
    </>
  );
}
