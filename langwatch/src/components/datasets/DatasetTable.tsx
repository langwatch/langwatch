import { DownloadIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Container,
  HStack,
  Heading,
  Spacer,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import Parse from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, Upload } from "react-feather";
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
import { UploadCSVModal } from "./UploadCSVModal";
import { nanoid } from "nanoid";

export function DatasetTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const datasetId = router.query.id;

  const { openDrawer } = useDrawer();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [savingStatus, setSavingStatus] = useState<"saving" | "saved" | "">("");

  const dataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId as string },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );
  const deleteDatasetRecord = api.datasetRecord.deleteMany.useMutation();

  const gridRef = useRef<AgGridReact>(null);

  const columnDefs = useMemo(() => {
    if (!dataset.data) return [];

    const headers: DatasetColumnDef[] = Object.entries(
      dataset.data.columnTypes ?? {}
    ).map(([field, type]) => ({
      headerName: field,
      field,
      type_: type,
      cellClass: "v-align",
      sortable: false,
    }));

    // Add row number column
    headers.unshift({
      headerName: "#",
      valueGetter: "node.rowIndex + 1",
      type_: "number",
      width: 42,
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
  }, [dataset.data]);

  const [editableRowData, setEditableRowData] = useState<Record<string, any>[]>(
    []
  );

  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set()
  );

  const rowData = useMemo(() => {
    if (!dataset.data) return;

    const columns = Object.keys(dataset.data.columnTypes ?? {});
    return dataset.data.datasetRecords.map((record) => {
      const row: Record<string, any> = { id: record.id };
      columns.forEach((col) => {
        const value = (record.entry as any)[col];
        row[col] = typeof value === "object" ? JSON.stringify(value) : value;
      });
      row.selected = selectedEntryIds.has(record.id);
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.data]);

  useEffect(() => {
    if (rowData) {
      setEditableRowData(
        rowData.map((row) => ({
          ...row,
          selected: selectedEntryIds.has(row.id),
        }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowData]);

  const toast = useToast();

  const downloadCSV = (selectedOnly = false) => {
    const columns = Object.keys(dataset.data?.columnTypes ?? {}) ?? [];
    const csvData =
      dataset.data?.datasetRecords
        .filter((record) =>
          selectedOnly ? selectedEntryIds.has(record.id) : true
        )
        .map((record) =>
          columns.map((col) => {
            const value = (record.entry as any)[col];
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
    const fileName = `${dataset.data?.name}${
      selectedOnly ? "_selected" : ""
    }.csv`;
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
        const currentIndex = rows.findIndex((row) => row.id === params.data.id);
        if (currentIndex === -1) {
          return [...rows, updatedRecord];
        } else {
          const newRows = [...rows];
          newRows[currentIndex] = {
            ...newRows[currentIndex],
            ...updatedRecord,
          };
          return newRows;
        }
      });

      setSavingStatus("saving");
      updateDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId as string,
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
            void dataset.refetch();
            setSavingStatus("");
          },
        }
      );
    },
    [
      editableRowData,
      updateDatasetRecord,
      project?.id,
      datasetId,
      toast,
      dataset,
    ]
  );

  const onDelete = useCallback(() => {
    if (confirm("Are you sure?")) {
      const recordIds = Array.from(selectedEntryIds);
      deleteDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: datasetId as string,
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
            dataset
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
            void dataset.refetch();
          },
        }
      );
    }
  }, [
    selectedEntryIds,
    deleteDatasetRecord,
    project?.id,
    datasetId,
    toast,
    dataset,
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
      <Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
        paddingBottom="120px"
      >
        <HStack
          width="full"
          verticalAlign={"middle"}
          paddingBottom={6}
          spacing={6}
        >
          <Heading as={"h1"} size="lg">
            Dataset {`- ${dataset.data?.name ?? ""}`}
          </Heading>
          <Text fontSize={"14px"} color="gray.400">
            {editableRowData.length} records
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
            Upload CSV
          </Button>
          <Button
            colorScheme="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => dataset.data && downloadCSV()}
          >
            Export <DownloadIcon marginLeft={2} />
          </Button>
          <Button
            colorScheme="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                datasetSlug: dataset.data?.slug,
              });
            }}
            minWidth="fit-content"
            leftIcon={<Play height={16} />}
          >
            Batch Evaluation
          </Button>
        </HStack>
        <Card>
          <CardBody padding={0} position="relative">
            <DatasetGrid
              columnDefs={columnDefs}
              rowData={rowData}
              onCellValueChanged={onCellValueChanged}
              ref={gridRef}
            />
            <Box position="absolute" left="0">
              <Button
                position="fixed"
                bottom={6}
                marginLeft={6}
                backgroundColor="#ffffff"
                padding="8px"
                paddingX="16px"
                border="1px solid #ccc"
                boxShadow="base"
                borderRadius={"md"}
                onClick={onAddNewRow}
                zIndex="popover"
              >
                <Plus />
                <Text>Add new record</Text>
              </Button>
            </Box>
          </CardBody>
        </Card>
        <UploadCSVModal
          isOpen={isOpen}
          onClose={onClose}
          datasetId={datasetId as string}
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
      </Container>
    </>
  );
}
