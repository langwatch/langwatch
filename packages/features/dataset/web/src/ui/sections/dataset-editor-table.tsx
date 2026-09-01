/**
 * The spreadsheet editor for one saved dataset: inline cell editing, type
 * validation, virtualized rows, a trailing phantom row, autosave and paging.
 *
 * A NARROWED family-local copy of
 * `platform/app/src/components/datasets/editor/DatasetEditorTable`, which the
 * workflow dataset node, the prompt demonstrations modal, the upload drawer and
 * the add-record drawer still render. Deletes-only forbids repointing those, so
 * the platform copy stays for them and this one travels with the dataset detail
 * screen.
 *
 * WHAT DID NOT TRAVEL, because the detail screen never passes it: the in-memory
 * mode (`inMemoryDataset` / `onUpdateDataset`), the imperative
 * `controllerRef` the AI-generation stream writes through, and the embedded
 * layout flags (`isEmbedded`, `hideButtons`, `bottomSpace`, `editorPortalRef`,
 * `canEditDatasetRecord`, `title`). A page renders one saved dataset, full
 * width, with every action. Half this component was the other callers' modes,
 * and carrying them into a package that serves one page would be carrying
 * dead code with a maintenance cost.
 */

import {
  Box,
  Button,
  Checkbox,
  Heading,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { DatasetColumns, DatasetPage } from "@langwatch/dataset-contract";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { Pagination } from "@langwatch/design-system/pagination";
import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Download, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { datasetApi } from "../../behavior/dataset-api";
import { useDatasetRecordSync } from "../../behavior/use-dataset-record-sync";
import {
  createDatasetEditorStore,
  type EditorColumn,
  type EditorRecord,
} from "../../behavior/use-dataset-editor-store";
import { useTableKeyboardNavigation } from "../../behavior/use-table-keyboard-navigation";
import { formatRecordCount } from "../../model/dataset-editor-copy";
import { datasetImageUrl } from "../../model/dataset-image-url";
import {
  type AutosaveState,
  type DatasetTableContextValue,
  DatasetTableProvider,
  type DatasetTableRowData,
} from "../../model/dataset-table-context";
import { datasetTableCss } from "../../model/dataset-table-styles";
import { useDatasetHost } from "../../model/dataset-host";
import { DatasetCellImage } from "../elements/dataset-cell-image";
import { SaveStatusChip } from "../elements/save-status-chip";
import { SelectionActionBar } from "../elements/selection-action-bar";
import { VirtualizedTableBody } from "../blocks/virtualized-table-body";
import { AddOrEditDatasetDrawer } from "./add-or-edit-dataset-drawer";
import { AddRowsFromCSVModal } from "./add-rows-from-csv-modal";

const CHECKBOX_WIDTH_PX = 36;
const MAX_ROWS_WITHOUT_VIRTUALIZATION = 100;
/** Records per page. One page comfortably fits the virtualized viewport while
 *  keeping each read bounded — an s3_jsonl page touches only the chunks
 *  overlapping the window. */
const DATASET_EDITOR_PAGE_SIZE = 50;

const renderImage = (value: string): ReactNode | null => {
  const imageUrl = datasetImageUrl(value);
  if (!imageUrl) return null;

  return (
    <DatasetCellImage
      src={imageUrl}
      minWidth="24px"
      minHeight="24px"
      maxHeight="80px"
      maxWidth="100%"
    />
  );
};

const toEditorColumns = (columnTypes: DatasetColumns): EditorColumn[] =>
  columnTypes.map((column, index) => ({
    id: `${column.name}_${index}`,
    name: column.name,
    type: column.type,
  }));

const stringifyCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const toEditorRecords = (
  datasetRecords: Array<{ id: string } & Record<string, unknown>>,
  columnTypes: DatasetColumns,
): EditorRecord[] =>
  datasetRecords.map((record) => ({
    id: record.id,
    ...Object.fromEntries(
      columnTypes.map((column) => [column.name, stringifyCellValue(record[column.name])]),
    ),
  }));

const toEntryRecords = (
  rows: ReadonlyArray<{ id: string; entry: unknown }>,
): Array<{ id: string } & Record<string, unknown>> =>
  rows.map((row) => ({ id: row.id, ...(row.entry as Record<string, unknown>) }));

export function DatasetEditorTable({
  datasetId,
  readEnabled = true,
  headerActions,
}: {
  datasetId: string;
  /** Gate the record read: false while the dataset is still preparing or has
   *  failed (ADR-032 I-READY), so `listPaginated` is never asked for a dataset
   *  that would refuse it. */
  readEnabled?: boolean;
  /** Page-specific actions rendered at the end of the chrome button row. */
  headerActions?: ReactNode;
}) {
  const host = useDatasetHost();
  const project = host.project();
  const [store] = useState(() => createDatasetEditorStore());
  const editColumnsDrawer = useDisclosure();
  const addRowsFromCSVModal = useDisclosure();

  // ── Data loading ──────────────────────────────────────────────────

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATASET_EDITOR_PAGE_SIZE);

  const databaseDataset = datasetApi.datasetRecord.listPaginated.useQuery(
    { projectId: project?.id ?? "", datasetId, page, limit: pageSize },
    {
      enabled: !!project && !!datasetId && readEnabled,
      refetchOnWindowFocus: false,
      // Hold the previous page's result while the next page loads, so a page
      // switch doesn't blank the grid (and doesn't momentarily drop the page
      // count, which would otherwise bounce navigation back to page 1). Written
      // out rather than imported as React Query's `keepPreviousData`, which a
      // screen closure may not reach for.
      placeholderData: (previous: DatasetPage | null | undefined) => previous,
      // A background refetch (e.g. on reconnect) would reload the store via
      // setData and drop an unsaved local edit on the current page — page
      // navigation is gated on pending writes, but an automatic refetch is not,
      // so disable it.
      refetchOnReconnect: false,
      // staleTime 0: returning to a previously-viewed page refetches in the
      // background so a cell edited then navigated-away-from shows its saved
      // value on return (the edit is persisted per-record, not into this cache).
      staleTime: 0,
    },
  );

  const databaseDatasetError = databaseDataset.error;
  useEffect(() => {
    if (!databaseDatasetError) return;
    host.failed({ error: databaseDatasetError, fallbackTitle: "Couldn't load dataset" });
  }, [databaseDatasetError, host]);

  // The PG-authoritative total record count from the last settled read (undefined
  // until the first response; held across a page switch by the placeholder so it
  // never momentarily resets mid-navigation). Deriving the page count from
  // `count / pageSize` — rather than reading the server's `totalPages` — keeps it
  // correct the instant the reader changes the rows-per-page. `pageCount` floors
  // at 1 so an EMPTY dataset still reads as a single page and never asks for page
  // 0 (which the server's `positive()` guard would reject).
  const serverRecordCount = databaseDataset.data?.count;
  const pageCount = Math.max(1, Math.ceil((serverRecordCount ?? 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const isLastPage = currentPage >= pageCount;

  // Snap a now-out-of-range page back into range — e.g. the last page's rows
  // were all deleted under us (the post-delete refetch shrinks the count).
  // Acts ONLY on an authoritative count — never on absent data — so an in-flight
  // page switch can't bounce navigation back to page 1.
  useEffect(() => {
    if (serverRecordCount == null) return;
    const count = Math.max(1, Math.ceil(serverRecordCount / pageSize));
    if (page > count) setPage(count);
  }, [serverRecordCount, pageSize, page]);

  const datasetName = databaseDataset.data?.name;
  const columnTypes: DatasetColumns = useMemo(
    () => databaseDataset.data?.columnTypes ?? [],
    [databaseDataset.data],
  );

  // While the placeholder serves the prior key's result during a key change,
  // `isPlaceholderData` is true. Skip hydrating from it: a `datasetId` switch
  // would otherwise populate the grid with the OLD dataset's rows under the NEW
  // id. For a same-dataset page switch this just holds the current page until
  // the next one lands.
  const holdingPreviousData = databaseDataset.isPlaceholderData;
  useEffect(() => {
    if (!databaseDataset.data || holdingPreviousData) return;
    const columns = toEditorColumns(databaseDataset.data.columnTypes);
    const records = toEditorRecords(
      toEntryRecords(databaseDataset.data.datasetRecords),
      databaseDataset.data.columnTypes,
    );
    store.getState().setData({ columns, records, dbDatasetId: datasetId });
  }, [datasetId, databaseDataset.data, holdingPreviousData, store]);

  // ── Store subscriptions ───────────────────────────────────────────

  const columns = useStore(store, (state) => state.columns);
  const records = useStore(store, (state) => state.records);
  const pendingSavedChanges = useStore(store, (state) => state.pendingSavedChanges);
  const editingCell = useStore(store, (state) => state.editingCell);
  const selectedCell = useStore(store, (state) => state.selectedCell);
  const selectedRows = useStore(store, (state) => state.selectedRows);
  const expandedCells = useStore(store, (state) => state.expandedCells);
  const rowHeightMode = useStore(store, (state) => state.rowHeightMode);
  const autosave = useStore(store, (state) => state.autosave);

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

  // ── Autosave sync ─────────────────────────────────────────────────

  const resolveFullRecord = useCallback(
    (_dbDatasetId: string, recordId: string) =>
      store.getState().records.find((record) => record.id === recordId),
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
    // After a deletion settles, refresh the server total so the pager reflects
    // the smaller dataset and the clamp effect can snap off a now-empty last
    // page.
    onRecordsDeleted: () => {
      void databaseDataset.refetch();
    },
  });

  // ── Table assembly ────────────────────────────────────────────────

  const rowCount = records.length;
  // The trailing phantom row (Excel-style "click to add") appends to the END of
  // the dataset, so on the paged view it belongs only on the last page — adding
  // it on an earlier full page would create a row the reader can't see.
  const showAddRow = isLastPage;
  const displayRowCount = showAddRow ? Math.max(rowCount + 1, 3) : rowCount;

  // Block page navigation while a record save is queued or in flight: switching
  // pages reloads the store (setData drops the prior page's records), so an
  // unsaved edit on the outgoing page would be stranded (resolveFullRecord can
  // no longer find it). The autosave debounce is short, so this is a brief gate.
  const hasPendingWrites =
    autosave.state === "saving" || Object.keys(pendingSavedChanges[datasetId] ?? {}).length > 0;

  // The count chip shows the PG-authoritative whole-dataset total, not just the
  // rows on this page; the pager shows the position within it.
  const totalRecordCount = serverRecordCount ?? rowCount;

  const rowData = useMemo((): DatasetTableRowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => {
      const record = records[index];
      const dataset = Object.fromEntries(
        columns.map((column) => [column.id, record?.[column.name] ?? ""]),
      );
      const isEmpty = Object.values(dataset).every((value) => value === "");
      return { rowIndex: index, dataset, isEmpty };
    });
  }, [records, columns, displayRowCount]);

  const columnHelper = useMemo(() => createColumnHelper<DatasetTableRowData>(), []);

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
          meta: { columnType: "dataset", columnId: column.id, dataType: column.type },
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
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
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
    const handleClickOutside = (event: MouseEvent) => {
      if (!store.getState().selectedCell) return;
      if (tableRef.current?.contains(event.target as Node)) return;
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
      renderImage,
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
    ],
  );

  const shouldVirtualize = rowCount > MAX_ROWS_WITHOUT_VIRTUALIZATION;

  // ── Actions chrome ────────────────────────────────────────────────

  const downloadDataset = datasetApi.datasetRecord.download.useMutation();
  const downloadCSV = useCallback(async () => {
    // The WHOLE dataset, not the page on screen: the download mutation is the
    // read with no byte budget, and the store only ever holds one page.
    let full;
    try {
      full = await downloadDataset.mutateAsync({ projectId: project?.id ?? "", datasetId });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't download dataset" });
      return;
    }

    const exportColumns = toEditorColumns(full.columnTypes);
    const exportRecords = toEditorRecords(toEntryRecords(full.datasetRecords), full.columnTypes);

    const csv = Papa.unparse({
      fields: exportColumns.map((column) => column.name),
      data: exportRecords.map((record) => exportColumns.map((column) => record[column.name] ?? "")),
    });

    const url = window.URL.createObjectURL(new Blob([csv]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `${datasetName?.toLowerCase().replace(/ /g, "_") ?? "dataset"}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, [datasetId, datasetName, downloadDataset, host, project?.id]);

  // "Add row" only appends an empty row at the bottom. It must not steal focus
  // into the first cell or pop the cell editor open: on an empty dataset the new
  // row is row 0, so auto-editing looks like the grid jumped into editing the
  // first cell on its own. The reader clicks the new row to edit it.
  const handleAddRow = useCallback(() => addRow(), [addRow]);

  return (
    <VStack align="stretch" gap={3} width="full" data-testid="dataset-editor-table">
      <HStack gap={3} align="center" width="full">
        {datasetName && <Heading data-testid="dataset-title">{datasetName}</Heading>}
        <Text fontSize="13px" color="fg.muted" data-testid="dataset-row-count">
          {formatRecordCount(totalRecordCount)} {totalRecordCount === 1 ? "record" : "records"}
        </Text>
        <SaveStatusChip state={autosave.state} error={autosave.error} />
        <Spacer />
        <Button
          size="sm"
          variant="ghost"
          data-testid="download-csv"
          loading={downloadDataset.isPending}
          onClick={() => void downloadCSV()}
        >
          <Download size={16} /> Download as CSV
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="add-rows-from-csv"
          onClick={() => addRowsFromCSVModal.onOpen()}
        >
          <Upload size={16} /> Add rows
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="edit-columns"
          onClick={() => editColumnsDrawer.onOpen()}
        >
          <Pencil size={14} /> Edit columns
        </Button>
        {headerActions}
      </HStack>

      <Box
        width="full"
        overflowY="auto"
        maxHeight="calc(100vh - 250px)"
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
              {columns.map((column) => (
                <col key={column.id} />
              ))}
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
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
                activeDatasetId={datasetId}
                isLoading={databaseDataset.isLoading}
                shouldVirtualize={shouldVirtualize}
                disableVirtualization={false}
                displayRowCount={displayRowCount}
              />
            </tbody>
          </table>
        </DatasetTableProvider>
      </Box>

      <HStack>
        {showAddRow && (
          <Button size="sm" variant="ghost" data-testid="add-row" onClick={handleAddRow}>
            <Plus size={14} /> Add row
          </Button>
        )}
        <Spacer />
      </HStack>

      <Pagination
        page={currentPage}
        pageSize={pageSize}
        totalCount={totalRecordCount}
        isLoading={databaseDataset.isLoading}
        // Block navigation while a record save is queued or in flight; a page
        // switch reloads the store and would strand an unsaved edit.
        navDisabled={hasPendingWrites}
        onPageChange={(nextPage) => {
          clearRowSelection();
          setPage(nextPage);
        }}
        onPageSizeChange={(nextSize) => {
          clearRowSelection();
          setPageSize(nextSize);
          setPage(1);
        }}
      />

      {selectedRows.size > 0 && (
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
          datasetToSave={{ datasetId, name: datasetName ?? undefined, columnTypes }}
          onSuccess={() => {
            editColumnsDrawer.onClose();
            void databaseDataset.refetch();
          }}
        />
      )}

      {addRowsFromCSVModal.open && (
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
      onClick={(event) => event.stopPropagation()}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
    </Checkbox.Root>
  );
}
