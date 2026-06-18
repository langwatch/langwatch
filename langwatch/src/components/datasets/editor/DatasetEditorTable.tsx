/**
 * Standalone spreadsheet editor for a single dataset: the same TanStack
 * table experience as the evaluations workbench (inline cell editing, type
 * validation, virtualized rows, trailing phantom row), reusable anywhere a
 * dataset is viewed or edited.
 *
 * Two modes:
 *  - Saved (`datasetId`): loads records from the database and autosaves cell
 *    edits, new rows, and deletions through useDatasetRecordSync, surfacing
 *    status through the save chip.
 *  - In-memory (`inMemoryDataset` + `onUpdateDataset`): the caller owns the
 *    data (draft datasets in the workflow DSL, prompt demonstrations);
 *    every change is propagated up, nothing touches the network.
 */
import {
  Box,
  Button,
  Checkbox,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import Parse from "papaparse";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Download, Edit2, Plus, Trash2, Upload, X } from "react-feather";
import { useStore } from "zustand";

import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { ColumnTypeIcon } from "~/components/shared/ColumnTypeIcon";
import { SelectionActionBar } from "~/components/ui/SelectionActionBar";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "~/server/datasets/types";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { AddRowsFromCSVModal } from "../AddRowsFromCSVModal";
import {
  type AutosaveState,
  type DatasetTableContextValue,
  DatasetTableProvider,
  type DatasetTableRowData,
} from "./DatasetTableContext";
import { datasetTableCss } from "./datasetTableStyles";
import {
  createDatasetEditorStore,
  type EditorColumn,
  type EditorRecord,
  rekeyEditorRecords,
} from "./useDatasetEditorStore";
import { useDatasetRecordSync } from "./useDatasetRecordSync";
import { useTableKeyboardNavigation } from "./useTableKeyboardNavigation";
import { VirtualizedTableBody } from "./VirtualizedTableBody";

export type InMemoryDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: DatasetRecordEntry[];
  columnTypes: DatasetColumns;
};

/**
 * Imperative surface for external writers that stream changes into the
 * table (the wizard's AI dataset generation). Rows changed through the
 * controller are display-synced only; the caller owns persistence.
 */
export type DatasetEditorController = {
  addRow: (record: EditorRecord) => void;
  updateRow: (record: EditorRecord) => void;
  removeRow: (recordId: string) => void;
  getColumns: () => EditorColumn[];
};

const CHECKBOX_WIDTH_PX = 36;
const MAX_ROWS_WITHOUT_VIRTUALIZATION = 100;

const toEditorColumns = (columnTypes: DatasetColumns): EditorColumn[] =>
  columnTypes.map((col, index) => ({
    id: `${col.name}_${index}`,
    name: col.name,
    type: col.type,
  }));

const stringifyCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const toEditorRecords = (
  datasetRecords: DatasetRecordEntry[],
  columnTypes: DatasetColumns,
): EditorRecord[] =>
  datasetRecords.map((record) => ({
    id: record.id,
    ...Object.fromEntries(
      columnTypes.map((col) => [
        col.name,
        stringifyCellValue((record as Record<string, unknown>)[col.name]),
      ]),
    ),
  }));

export function DatasetEditorTable({
  datasetId,
  inMemoryDataset,
  onUpdateDataset,
  title,
  hideButtons = false,
  isEmbedded = false,
  floatingSelectionBar = false,
  canEditDatasetRecord = true,
  bottomSpace,
  controllerRef,
  onColumnsChanged,
  editorPortalRef,
  headerActions,
  readEnabled = true,
}: {
  datasetId?: string;
  inMemoryDataset?: InMemoryDataset;
  onUpdateDataset?: (dataset: InMemoryDataset & { datasetId?: string }) => void;
  title?: ReactNode;
  hideButtons?: boolean;
  isEmbedded?: boolean;
  /** Gate the record read: when false the editor does not fetch records (the
   *  dataset is still preparing or failed, ADR-032 I-READY). Defaults to true
   *  so existing hosts are unaffected. */
  readEnabled?: boolean;
  /** Render the row-selection actions as a floating bottom-center bar instead
   *  of an inline toolbar button. For standalone pages (the dataset detail
   *  page); leave off inside modals/drawers where a viewport-fixed bar would
   *  sit behind the overlay. */
  floatingSelectionBar?: boolean;
  /** Page-specific actions rendered at the end of the chrome button row. */
  headerActions?: ReactNode;
  /** Disable editing the dataset definition (columns) in the database. */
  canEditDatasetRecord?: boolean;
  bottomSpace?: string;
  controllerRef?: React.MutableRefObject<DatasetEditorController | null>;
  /** Called after column changes are saved (saved mode), so hosts can
   *  propagate the new shape (e.g. the workflow node merges new columns
   *  into its outputs). */
  onColumnsChanged?: (columnTypes: DatasetColumns) => void;
  /** Pass when hosting the editor inside a modal dialog so the floating
   *  cell editor stays within the dialog's pointer-events scope. */
  editorPortalRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { project } = useOrganizationTeamProject();
  const [store] = useState(() => createDatasetEditorStore());
  const editColumnsDrawer = useDisclosure();
  const addRowsFromCSVModal = useDisclosure();

  // ── Data loading ──────────────────────────────────────────────────

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      // Gated on `readEnabled` so a still-preparing/failed dataset is never read
      // (getAll → getFullDataset throws DatasetNotReadyError otherwise).
      enabled: !!project && !!datasetId && readEnabled,
      refetchOnWindowFocus: false,
      onError: (error) => {
        if (isHandledByGlobalHandler(error)) return;
        toaster.create({
          title: "Error fetching dataset",
          description: error.message,
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
      },
    },
  );

  const datasetName = datasetId
    ? databaseDataset.data?.name
    : inMemoryDataset?.name;
  const columnTypes: DatasetColumns = useMemo(
    () =>
      datasetId
        ? ((databaseDataset.data?.columnTypes ?? []) as DatasetColumns)
        : (inMemoryDataset?.columnTypes ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- in-memory columns sync on load only, like the data below
    [datasetId, databaseDataset.data],
  );

  // Load data into the store. For in-memory mode this happens once on mount
  // (the editor owns the working copy afterwards; parent updates flow the
  // other way via onUpdateDataset).
  const loadedRef = useRef(false);
  const lastPropagatedRef = useRef<EditorRecord[] | null>(null);
  useEffect(() => {
    if (datasetId && databaseDataset.data) {
      const columns = toEditorColumns(
        (databaseDataset.data.columnTypes ?? []) as DatasetColumns,
      );
      const records = toEditorRecords(
        (databaseDataset.data.datasetRecords ?? []).map(
          (record: { id: string; entry: unknown }) => ({
            id: record.id,
            ...(record.entry as Record<string, unknown>),
          }),
        ),
        (databaseDataset.data.columnTypes ?? []) as DatasetColumns,
      );
      store.getState().setData({ columns, records, dbDatasetId: datasetId });
      loadedRef.current = true;
      lastPropagatedRef.current = store.getState().records;
    } else if (!datasetId && inMemoryDataset && !loadedRef.current) {
      store.getState().setData({
        columns: toEditorColumns(inMemoryDataset.columnTypes),
        records: toEditorRecords(
          inMemoryDataset.datasetRecords,
          inMemoryDataset.columnTypes,
        ),
        dbDatasetId: undefined,
      });
      loadedRef.current = true;
      lastPropagatedRef.current = store.getState().records;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, databaseDataset.data, store]);

  // Imperative controller for external writers (AI generation streams)
  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = {
      addRow: (record) => store.getState().upsertExternalRecord(record),
      updateRow: (record) => store.getState().upsertExternalRecord(record),
      removeRow: (recordId) => store.getState().removeExternalRecord(recordId),
      getColumns: () => store.getState().columns,
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, store]);

  // ── Store subscriptions ───────────────────────────────────────────

  const columns = useStore(store, (s) => s.columns);
  const records = useStore(store, (s) => s.records);
  const pendingSavedChanges = useStore(store, (s) => s.pendingSavedChanges);
  const editingCell = useStore(store, (s) => s.editingCell);
  const selectedCell = useStore(store, (s) => s.selectedCell);
  const selectedRows = useStore(store, (s) => s.selectedRows);
  const expandedCells = useStore(store, (s) => s.expandedCells);
  const rowHeightMode = useStore(store, (s) => s.rowHeightMode);
  const autosave = useStore(store, (s) => s.autosave);

  // Actions are stable on the vanilla store
  const {
    setCellValue,
    setEditingCell,
    setSelectedCell,
    toggleCellExpanded,
    toggleRowSelection,
    selectAllRows,
    clearRowSelection,
    deleteSelectedRows,
    addRow,
    clearPendingChange,
    setAutosave,
  } = store.getState();

  // ── In-memory propagation ─────────────────────────────────────────

  const onUpdateDatasetRef = useRef(onUpdateDataset);
  onUpdateDatasetRef.current = onUpdateDataset;
  const inMemoryMetaRef = useRef({
    datasetId: inMemoryDataset?.datasetId,
    name: inMemoryDataset?.name,
  });
  useEffect(() => {
    if (datasetId) return;
    // Subscribe to the store directly: render-effect ordering would otherwise
    // race the initial setData and propagate stale/empty snapshots.
    return store.subscribe((state, prevState) => {
      if (!loadedRef.current) return;
      if (state.records === prevState.records) return;
      if (lastPropagatedRef.current === state.records) return;
      lastPropagatedRef.current = state.records;
      onUpdateDatasetRef.current?.({
        datasetId: inMemoryMetaRef.current.datasetId,
        name: inMemoryMetaRef.current.name,
        columnTypes: state.columns.map(({ name, type }) => ({ name, type })),
        datasetRecords: state.records.map((r) => ({ ...r })),
      });
    });
  }, [datasetId, store]);

  // ── Autosave sync (saved mode) ────────────────────────────────────

  const resolveFullRecord = useCallback(
    (_dbDatasetId: string, recordId: string) =>
      store.getState().records.find((r) => r.id === recordId),
    [store],
  );
  const onStatus = useCallback(
    (state: AutosaveState, error?: string) => setAutosave(state, error),
    [setAutosave],
  );
  useDatasetRecordSync({
    projectId: project?.id,
    pendingSavedChanges,
    resolveFullRecord,
    clearPendingChange,
    onStatus,
  });

  // ── Table assembly ────────────────────────────────────────────────

  const rowCount = records.length;
  // Always include one trailing phantom row (Excel-style "click to add")
  const displayRowCount = Math.max(rowCount + 1, 3);

  const rowData = useMemo((): DatasetTableRowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => {
      const record = records[index];
      const dataset = Object.fromEntries(
        columns.map((col) => [col.id, record?.[col.name] ?? ""]),
      );
      const isEmpty = Object.values(dataset).every((v) => v === "");
      return { rowIndex: index, dataset, isEmpty };
    });
  }, [records, columns, displayRowCount]);

  const columnHelper = useMemo(
    () => createColumnHelper<DatasetTableRowData>(),
    [],
  );

  const allSelected = selectedRows.size === rowCount && rowCount > 0;

  const tableColumns = useMemo(() => {
    const cols: ColumnDef<DatasetTableRowData>[] = [];

    cols.push(
      columnHelper.display({
        id: "select",
        header: () => (
          <Checkbox.Root
            size="sm"
            top="1px"
            aria-label="Select all rows"
            checked={allSelected}
            onCheckedChange={() => {
              if (allSelected) {
                clearRowSelection();
              } else {
                selectAllRows(rowCount);
              }
            }}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        ),
        cell: (info) => (
          <RowCheckbox
            rowIndex={info.row.index}
            checked={selectedRows.has(info.row.index)}
            onToggle={toggleRowSelection}
          />
        ),
        size: CHECKBOX_WIDTH_PX,
        enableResizing: false,
        meta: { columnType: "checkbox", columnId: "__checkbox__" },
      }) as ColumnDef<DatasetTableRowData>,
    );

    for (const column of columns) {
      cols.push(
        columnHelper.accessor((row) => row.dataset[column.id], {
          id: `dataset.${column.id}`,
          header: () => (
            <HStack gap={1}>
              <ColumnTypeIcon type={column.type} />
              <Text fontSize="13px" fontWeight="medium">
                {column.name}
              </Text>
            </HStack>
          ),
          cell: (info) => info.getValue(),
          meta: {
            columnType: "dataset",
            columnId: column.id,
            dataType: column.type,
          },
        }) as ColumnDef<DatasetTableRowData>,
      );
    }

    return cols;
  }, [
    columnHelper,
    columns,
    allSelected,
    rowCount,
    selectedRows,
    clearRowSelection,
    selectAllRows,
    toggleRowSelection,
  ]);

  const table = useReactTable({
    data: rowData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Scroll container detection for virtualization
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(
    null,
  );
  useEffect(() => {
    if (!tableRef.current) return;
    let parent = tableRef.current.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflow === "auto" || style.overflowY === "auto") {
        setScrollContainer(parent);
        break;
      }
      parent = parent.parentElement;
    }
  }, []);

  // Clear cell selection when clicking outside the table
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!store.getState().selectedCell) return;
      if (tableRef.current?.contains(e.target as Node)) return;
      setSelectedCell(undefined);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [store, setSelectedCell]);

  useTableKeyboardNavigation({
    datasetColumns: columns,
    targets: [],
    displayRowCount,
    editingCell,
    selectedCell,
    setSelectedCell,
    setEditingCell,
    toggleRowSelection,
  });

  const contextValue: DatasetTableContextValue = useMemo(
    () => ({
      rowHeightMode,
      expandedCells,
      editingCell,
      selectedCell,
      setCellValue,
      setEditingCell,
      setSelectedCell,
      toggleCellExpanded,
      toggleRowSelection,
      editorPortalRef,
    }),
    [
      rowHeightMode,
      expandedCells,
      editingCell,
      selectedCell,
      setCellValue,
      setEditingCell,
      setSelectedCell,
      toggleCellExpanded,
      toggleRowSelection,
      editorPortalRef,
    ],
  );

  const shouldVirtualize = rowCount > MAX_ROWS_WITHOUT_VIRTUALIZATION;

  // ── Actions chrome ────────────────────────────────────────────────

  const downloadDataset = api.datasetRecord.download.useMutation();
  const downloadCSV = useCallback(async () => {
    let exportColumns = columns;
    let exportRecords = store.getState().records;
    if (datasetId) {
      try {
        const fullDataset = await downloadDataset.mutateAsync({
          projectId: project?.id ?? "",
          datasetId,
        });
        const fullColumnTypes = (fullDataset?.columnTypes ??
          []) as DatasetColumns;
        exportColumns = toEditorColumns(fullColumnTypes);
        exportRecords = toEditorRecords(
          (fullDataset?.datasetRecords ?? []).map(
            (record: { id: string; entry: unknown }) => ({
              id: record.id,
              ...(record.entry as Record<string, unknown>),
            }),
          ),
          fullColumnTypes,
        );
      } catch {
        toaster.create({
          title: "Error downloading dataset",
          description: "Please try again",
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });
        return;
      }
    }

    const csv = Parse.unparse({
      fields: exportColumns.map((col) => col.name),
      data: exportRecords.map((record) =>
        exportColumns.map((col) => record[col.name] ?? ""),
      ),
    });

    const url = window.URL.createObjectURL(new Blob([csv]));
    const link = document.createElement("a");
    link.href = url;
    const fileName = `${
      datasetName?.toLowerCase().replace(/ /g, "_") ?? "draft_dataset"
    }.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, [columns, datasetId, datasetName, downloadDataset, project?.id, store]);

  // "Add row" only appends an empty row at the bottom. It must not steal focus
  // into the first cell or pop the cell editor open: on an empty dataset the
  // new row is row 0, so auto-editing looks like the grid jumped into editing
  // the first cell on its own. The user clicks the new row to edit it.
  const handleAddRow = useCallback(() => {
    addRow();
  }, [addRow]);

  return (
    <VStack
      align="stretch"
      gap={3}
      width="full"
      height={isEmbedded ? "full" : undefined}
      data-testid="dataset-editor-table"
    >
      <HStack gap={3} align="center" width="full">
        {title === undefined && datasetName ? (
          <Heading data-testid="dataset-title">{datasetName}</Heading>
        ) : typeof title === "string" ? (
          <Heading size="md">{title}</Heading>
        ) : (
          title
        )}
        <Text fontSize="13px" color="fg.muted" data-testid="dataset-row-count">
          {rowCount} {rowCount === 1 ? "record" : "records"}
        </Text>
        {datasetId && (
          <SaveStatusChip state={autosave.state} error={autosave.error} />
        )}
        <Spacer />
        {!floatingSelectionBar && selectedRows.size > 0 && (
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            data-testid="delete-selected-rows"
            onClick={() => deleteSelectedRows()}
          >
            <X size={14} /> Delete {selectedRows.size}{" "}
            {selectedRows.size === 1 ? "row" : "rows"}
          </Button>
        )}
        {!hideButtons && (
          <>
            <Button
              size="sm"
              variant="ghost"
              data-testid="download-csv"
              loading={downloadDataset.isLoading}
              onClick={() => void downloadCSV()}
            >
              <Download size={16} /> Download as CSV
            </Button>
            {datasetId && (
              <Button
                size="sm"
                variant="ghost"
                data-testid="add-rows-from-csv"
                onClick={() => addRowsFromCSVModal.onOpen()}
              >
                <Upload size={16} /> Add rows
              </Button>
            )}
            {canEditDatasetRecord && (
              <Button
                size="sm"
                variant="outline"
                data-testid="edit-columns"
                onClick={() => editColumnsDrawer.onOpen()}
              >
                <Edit2 size={14} /> Edit columns
              </Button>
            )}
          </>
        )}
        {headerActions}
      </HStack>

      <Box
        width="full"
        overflowY="auto"
        flex={isEmbedded ? 1 : undefined}
        maxHeight={isEmbedded ? undefined : "calc(100vh - 250px)"}
        borderWidth="1px"
        borderColor="border.emphasized"
        borderRadius="md"
        css={{
          ...datasetTableCss,
          "& table": {
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
          },
          "& thead th": { position: "sticky", top: 0, zIndex: 2 },
        }}
      >
        <DatasetTableProvider value={contextValue}>
          <table ref={tableRef} data-testid="dataset-editor-grid">
            <colgroup>
              <col style={{ width: CHECKBOX_WIDTH_PX }} />
              {columns.map((col) => (
                <col key={col.id} />
              ))}
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              <VirtualizedTableBody
                rows={table.getRowModel().rows}
                scrollContainer={scrollContainer}
                columnCount={table.getAllColumns().length}
                selectedRows={selectedRows}
                activeDatasetId={datasetId ?? "in-memory"}
                isLoading={!!datasetId && databaseDataset.isLoading}
                shouldVirtualize={shouldVirtualize}
                disableVirtualization={false}
                displayRowCount={displayRowCount}
              />
            </tbody>
          </table>
        </DatasetTableProvider>
      </Box>

      <HStack>
        <Button
          size="sm"
          variant="ghost"
          data-testid="add-row"
          onClick={handleAddRow}
        >
          <Plus size={14} /> Add row
        </Button>
        <Spacer />
      </HStack>
      {bottomSpace && <Box height={bottomSpace} flexShrink={0} />}

      {floatingSelectionBar && selectedRows.size > 0 && (
        <SelectionActionBar
          label={`${selectedRows.size} selected`}
          onClear={clearRowSelection}
          testId="dataset-selection-bar"
        >
          <Button
            size="xs"
            variant="outline"
            colorPalette="red"
            data-testid="delete-selected-rows"
            onClick={() => deleteSelectedRows()}
          >
            <Trash2 size={14} /> Delete
          </Button>
        </SelectionActionBar>
      )}

      {editColumnsDrawer.open && (
        <AddOrEditDatasetDrawer
          open={editColumnsDrawer.open}
          onClose={editColumnsDrawer.onClose}
          datasetToSave={{
            datasetId,
            name: datasetName ?? undefined,
            columnTypes,
          }}
          localOnly={!datasetId}
          onSuccess={(updated) => {
            editColumnsDrawer.onClose();
            if (datasetId) {
              void databaseDataset.refetch();
              onColumnsChanged?.(updated.columnTypes);
            } else {
              // Re-key the records onto the new columns and refresh the
              // propagation meta BEFORE setData: the store subscription
              // emits the update upward and must carry the new name.
              const state = store.getState();
              const rekeyedRecords = rekeyEditorRecords(
                state.records,
                state.columns,
                updated.columnTypes,
              );
              inMemoryMetaRef.current = {
                datasetId: inMemoryDataset?.datasetId,
                name: updated.name,
              };
              state.setData({
                columns: toEditorColumns(updated.columnTypes),
                records: rekeyedRecords,
                dbDatasetId: undefined,
              });
            }
          }}
        />
      )}

      {datasetId && addRowsFromCSVModal.open && (
        <AddRowsFromCSVModal
          isOpen={addRowsFromCSVModal.open}
          onClose={() => {
            addRowsFromCSVModal.onClose();
            void databaseDataset.refetch();
          }}
          datasetId={datasetId}
          columnTypes={columnTypes}
        />
      )}
    </VStack>
  );
}

function RowCheckbox({
  rowIndex,
  checked,
  onToggle,
}: {
  rowIndex: number;
  checked: boolean;
  onToggle: (row: number) => void;
}) {
  return (
    <Checkbox.Root
      size="sm"
      aria-label={`Select row ${rowIndex + 1}`}
      checked={checked}
      onCheckedChange={() => onToggle(rowIndex)}
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
    </Checkbox.Root>
  );
}

/**
 * Compact autosave indicator: nothing when idle, spinner while saving, check
 * on success, and a loud error with the message when a save fails: a
 * blocked save must never look like a successful one.
 */
export function SaveStatusChip({
  state,
  error,
}: {
  state: AutosaveState;
  error?: string;
}) {
  if (state === "saving") {
    return (
      <HStack gap={1} color="fg.muted" data-testid="save-status-saving">
        <Spinner size="xs" />
        <Text fontSize="12px">Saving…</Text>
      </HStack>
    );
  }
  if (state === "saved") {
    return (
      <HStack gap={1} color="green.fg" data-testid="save-status-saved">
        <Check size={13} />
        <Text fontSize="12px">Saved</Text>
      </HStack>
    );
  }
  if (state === "error") {
    return (
      <Tooltip content={error ?? "Unknown error"}>
        <HStack gap={1} color="red.fg" data-testid="save-status-error">
          <X size={13} />
          <Text fontSize="12px">Failed to save</Text>
        </HStack>
      </Tooltip>
    );
  }
  return null;
}
