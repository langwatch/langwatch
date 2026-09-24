/**
 * Standalone spreadsheet editor for one dataset. Two modes: saved
 * (`datasetId`, autosaves through `useDatasetRecordSync`) or in-memory
 * (`inMemoryDataset` + `onUpdateDataset`, caller owns the data).
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
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { downloadCsv } from "@langwatch/csv/download";
import {
  type AutosaveState,
  type DatasetAttachmentSlot,
  type DatasetTableContextValue,
  DatasetTableProvider,
  type DatasetTableRowData,
  datasetTableCss,
  useTableKeyboardNavigation,
  VirtualizedTableBody,
} from "@langwatch/dataset-browser-kit";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { ExternalImage, getImageUrl } from "@langwatch/design-system/external-image";
import { Pagination } from "@langwatch/design-system/pagination";
import { SearchInput } from "@langwatch/design-system/search-input";
import { SelectionActionBar } from "@langwatch/design-system/selection-action-bar";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { keepPreviousData } from "@tanstack/react-query";
import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Edit2, Plus, Trash2, Upload, X } from "react-feather";
import { useDebounce } from "use-debounce";
import { useStore } from "zustand";

import { useDatasetRecordSync } from "../../../../behavior/datasets/editor/use-dataset-record-sync.ts";
import {
  createDatasetEditorStore,
  type EditorColumn,
  type EditorRecord,
  rekeyEditorRecords,
} from "../../../../behavior/use-dataset-editor-store.ts";
import {
  formatSearchRecordCount,
  noSearchMatchesMessage,
  plainRecordCount,
  searchFailedMessage,
} from "../../../../model/dataset-editor-copy.ts";
import { AttachmentCell } from "../../attachment-cell.tsx";
import { AddOrEditDatasetDrawer } from "../add-or-edit-dataset-drawer.tsx";
import { AddRowsFromCSVModal } from "../add-rows-from-csv-modal.tsx";

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
/** Records per page for the saved-dataset editor (classic page N of M). One
 *  page comfortably fits the virtualized viewport while keeping each read
 *  bounded — an s3_jsonl page touches only the chunks overlapping the window. */
const DATASET_EDITOR_PAGE_SIZE = 50;

const renderAttachment = (slot: DatasetAttachmentSlot): ReactNode => <AttachmentCell {...slot} />;

const renderImage = (value: string): ReactNode | null => {
  const imageUrl = getImageUrl(value);
  if (!imageUrl) {
    return null;
  }

  return (
    <ExternalImage
      src={imageUrl}
      minWidth="24px"
      minHeight="24px"
      maxHeight="80px"
      maxWidth="100%"
      expandable
    />
  );
};

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

function EditorTableHeading({
  datasetName,
  title,
}: {
  datasetName?: string;
  title?: React.ReactNode;
}) {
  if (title === undefined && datasetName) {
    return <Heading data-testid="dataset-title">{datasetName}</Heading>;
  }
  if (typeof title === "string") return <Heading size="md">{title}</Heading>;

  return <>{title}</>;
}

function displayedRowCount({
  hasSearchFailed,
  showAddRow,
  rowCount,
}: {
  hasSearchFailed: boolean;
  showAddRow: boolean;
  rowCount: number;
}): number {
  if (hasSearchFailed) return 0;
  if (showAddRow) return Math.max(rowCount + 1, 3);
  return rowCount;
}

function rowCountLabel({
  isSearching,
  isMatchCountKnown,
  totalRecordCount,
  unsearchedRecordCount,
}: {
  isSearching: boolean;
  isMatchCountKnown: boolean;
  totalRecordCount: number;
  unsearchedRecordCount: number | undefined;
}): string {
  if (!isSearching) return plainRecordCount(totalRecordCount);
  if (isMatchCountKnown) {
    return formatSearchRecordCount({ matched: totalRecordCount, total: unsearchedRecordCount });
  }
  if (unsearchedRecordCount === undefined) return "";
  return plainRecordCount(unsearchedRecordCount);
}

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

  // Saved datasets are read one page at a time (classic page N of M) instead of
  // the whole dataset, which previously truncated past a byte cap and silently
  // hid the rest. In-memory mode (no datasetId) keeps its full local copy.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATASET_EDITOR_PAGE_SIZE);

  // Row search via paged read; saved datasets only (in-memory selection by position).
  const [searchInput, setSearchInput] = useState("");
  // The term is debounced TOGETHER with the dataset it was typed against — a
  // bare-string debounce would leave the previous dataset's term live for
  // 300ms after switching, long enough to fetch the new dataset narrowed by
  // a word never typed against it.
  const searchScope = useMemo(() => ({ datasetId, text: searchInput }), [datasetId, searchInput]);
  const [debouncedSearch] = useDebounce(searchScope, 300);
  const activeSearch =
    datasetId && debouncedSearch.datasetId === datasetId
      ? debouncedSearch.text.trim() || undefined
      : undefined;
  const isSearching = !!activeSearch;
  // Whether a search OWNS the grid: settled, or typed but not yet debounced.
  // `isSearching` alone is the wrong gate for withdrawing ways to add a row —
  // it trails the box by 300ms, long enough to offer a row search is about to
  // remove. RESULTS still gate on `isSearching`: nothing to say until it runs.
  const hasSearchTakenTheGrid = !!datasetId && (!!searchInput.trim() || isSearching);

  // Where the user was before the search started, so clearing it puts them back
  // rather than on page 1 — see `onSearchChange` below, which maintains it.
  const pageBeforeSearch = useRef<number | undefined>(undefined);
  // The dataset's own total, remembered from its last unsearched read — see the
  // count derivation below, which maintains it.
  const unsearchedRecordCount = useRef<number | undefined>(undefined);

  // Reset search/page/count per dataset during render (not effect) to avoid stale values.
  const [openDatasetId, setOpenDatasetId] = useState(datasetId);
  const datasetChanged = openDatasetId !== datasetId;
  if (datasetChanged) {
    setOpenDatasetId(datasetId);
    setSearchInput("");
    setPage(1);
    pageBeforeSearch.current = undefined;
    unsearchedRecordCount.current = undefined;
  }
  // The state reset above only lands on the re-render React schedules; the
  // query below reads its arguments from THIS render, which still holds the
  // previous dataset's page. Derive what to ask for so the new dataset is never
  // requested at a page that belonged to another one. (`activeSearch` needs no
  // equivalent — it is already gated on the term belonging to this dataset.)
  const requestedPage = datasetChanged ? 1 : page;

  const databaseDataset = api.datasetRecord.listPaginated.useQuery(
    {
      projectId: project?.id ?? "",
      datasetId: datasetId ?? "",
      page: requestedPage,
      limit: pageSize,
      search: activeSearch,
    },
    {
      // Gated on `readEnabled` so a still-preparing/failed dataset is never read
      // (listPaginated throws DatasetNotReadyError otherwise).
      enabled: !!project && !!datasetId && readEnabled,
      refetchOnWindowFocus: false,
      // Hold the previous page's result while the next page loads, so a page
      // switch doesn't blank the grid (and doesn't momentarily drop the page
      // count, which would otherwise bounce navigation back to page 1).
      placeholderData: keepPreviousData,
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
    showErrorToast({
      error: databaseDatasetError,
      fallbackTitle: "Couldn't load dataset",
    });
  }, [databaseDatasetError]);

  // Page count is derived from count/pageSize (not the server's totalPages) so
  // it's correct the instant rows-per-page changes, and floors at 1 so an
  // empty dataset never asks for page 0. currentPage is clamped to it.
  const serverRecordCount = datasetId ? databaseDataset.data?.count : undefined;

  // During search, count is matches; remember unsearched total; avoid placeholder data on switches.
  const holdingPreviousData = databaseDataset.isPlaceholderData;
  // Only ever remembered from a SETTLED read of the dataset being shown. Held
  // over from a placeholder, the number belongs to whichever dataset was open
  // before, and a later search would report "3 of 679" about a dataset with 3
  // rows in it — a total the user has no way to recognise as the wrong one.
  if (!isSearching && !holdingPreviousData && serverRecordCount != null) {
    unsearchedRecordCount.current = serverRecordCount;
  }

  const pageCount = Math.max(1, Math.ceil((serverRecordCount ?? 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const isLastPage = currentPage >= pageCount;
  // Snap page back into range; guard against search settling to avoid bouncing to page 1.
  const isSearchSettling = (searchInput.trim() || undefined) !== activeSearch;
  useEffect(() => {
    if (serverRecordCount == null || holdingPreviousData || isSearchSettling) return;
    const count = Math.max(1, Math.ceil(serverRecordCount / pageSize));
    if (page > count) setPage(count);
  }, [serverRecordCount, pageSize, page, holdingPreviousData, isSearchSettling]);

  const datasetName = datasetId ? databaseDataset.data?.name : inMemoryDataset?.name;
  const columnTypes: DatasetColumns = useMemo(
    () =>
      datasetId
        ? ((databaseDataset.data?.columnTypes ?? []) as DatasetColumns)
        : (inMemoryDataset?.columnTypes ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- in-memory columns sync on load only
    [datasetId, databaseDataset.data],
  );

  // Load data into the store. For in-memory mode this happens once on mount
  // (the editor owns the working copy afterwards; parent updates flow the
  // other way via onUpdateDataset).
  const loadedRef = useRef(false);
  const lastPropagatedRef = useRef<EditorRecord[] | null>(null);
  useEffect(() => {
    if (datasetId && databaseDataset.data && !holdingPreviousData) {
      const columns = toEditorColumns((databaseDataset.data.columnTypes ?? []) as DatasetColumns);
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
        records: toEditorRecords(inMemoryDataset.datasetRecords, inMemoryDataset.columnTypes),
        dbDatasetId: undefined,
      });
      loadedRef.current = true;
      lastPropagatedRef.current = store.getState().records;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, databaseDataset.data, holdingPreviousData, store]);

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

  // Search resets page/selection immediately; use event handler to avoid StrictMode replay.
  const onSearchChange = useCallback(
    (next: string) => {
      setSearchInput(next);
      if (next.trim()) {
        pageBeforeSearch.current ??= page;
        setPage(1);
      } else {
        setPage(pageBeforeSearch.current ?? 1);
        pageBeforeSearch.current = undefined;
      }
      clearRowSelection();
    },
    [clearRowSelection, page],
  );

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
    // After a deletion settles, refresh the server total so the pager reflects
    // the smaller dataset and the clamp effect can snap off a now-empty last
    // page. Saved mode only — in-memory deletes never touch this query.
    onRecordsDeleted: datasetId
      ? () => {
          void databaseDataset.refetch();
        }
      : undefined,
  });

  // A search withdraws the CSV import dialog, but only unmounts it — the
  // disclosure still believes it's open, so clearing the search would reopen
  // it, stale and empty, without being asked. Tell the disclosure it closed,
  // so "withdrawn" and "closed" cannot disagree.
  const isCsvModalOpen = addRowsFromCSVModal.open;
  const closeCsvModal = addRowsFromCSVModal.onClose;
  useEffect(() => {
    if (hasSearchTakenTheGrid && isCsvModalOpen) closeCsvModal();
  }, [hasSearchTakenTheGrid, isCsvModalOpen, closeCsvModal]);

  // ── Table assembly ────────────────────────────────────────────────

  const rowCount = records.length;
  // Show add-row only on last page (or in-memory), never during search (empty row wouldn't match).
  const showAddRow = (!datasetId || isLastPage) && !hasSearchTakenTheGrid;
  // A refused search leaves the rows read BEFORE it on screen: the store is only
  // written from a settled `data` (see the effect above), so an error leaves the
  // previous page in place. Those rows were never matched against the search,
  // and leaving them under a search box reads as "here is what matched" — a
  // complete, confident, false answer. Withdraw them and say what happened.
  const hasSearchFailed = isSearching && !!databaseDatasetError;
  // Match count only reportable once search settles; avoid false counts during in-flight or error.
  const isMatchCountKnown = !hasSearchFailed && !holdingPreviousData;
  const displayRowCount = displayedRowCount({ hasSearchFailed, showAddRow, rowCount });

  // Block page navigation while a record save is queued or in flight: switching
  // pages reloads the store (setData drops the prior page's records), so an
  // unsaved edit on the outgoing page would be stranded (resolveFullRecord can
  // no longer find it). The autosave debounce is short, so this is a brief gate.
  const hasPendingWrites =
    autosave.state === "saving" ||
    (datasetId ? Object.keys(pendingSavedChanges[datasetId] ?? {}).length > 0 : false);

  // The count chip shows the PG-authoritative whole-dataset total (`count`),
  // not just the rows on this page; the pager shows the position within it.
  // (Pagination replaced the old byte-cap truncation, so there is no longer a
  // partial-read state to surface.) `serverRecordCount` is derived once above.
  const totalRecordCount = serverRecordCount ?? rowCount;

  const rowData = useMemo((): DatasetTableRowData[] => {
    return Array.from({ length: displayRowCount }, (_, index) => {
      const record = records[index];
      const dataset = Object.fromEntries(columns.map((col) => [col.id, record?.[col.name] ?? ""]));
      const isEmpty = Object.values(dataset).every((v) => v === "");
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
      renderImage,
      renderAttachment,
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
        const fullColumnTypes = (fullDataset?.columnTypes ?? []) as DatasetColumns;
        exportColumns = toEditorColumns(fullColumnTypes);
        exportRecords = toEditorRecords(
          (fullDataset?.datasetRecords ?? []).map((record: { id: string; entry: unknown }) => ({
            id: record.id,
            ...(record.entry as Record<string, unknown>),
          })),
          fullColumnTypes,
        );
      } catch (error) {
        showErrorToast({ error, fallbackTitle: "Couldn't download dataset" });
        return;
      }
    }

    downloadCsv({
      fields: exportColumns.map((col) => col.name),
      rows: exportRecords.map((record) => exportColumns.map((col) => record[col.name] ?? "")),
      fileName: `${datasetName?.toLowerCase().replace(/ /g, "_") ?? "draft_dataset"}.csv`,
    });
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
        <EditorTableHeading datasetName={datasetName} title={title} />
        <Text fontSize="13px" color="fg.muted" data-testid="dataset-row-count">
          {/* With no match count to report (see `isMatchCountKnown`), the count
              on hand describes unsearched rows, so reporting it as the result
              of the search would be false. Report the dataset's own size
              instead, and say nothing at all when even that is not known. */}
          {rowCountLabel({
            isSearching,
            isMatchCountKnown,
            totalRecordCount,
            unsearchedRecordCount: unsearchedRecordCount.current,
          })}
        </Text>
        {datasetId && <SaveStatusChip state={autosave.state} error={autosave.error} />}
        <Spacer />
        {/* Saved datasets only — see the `activeSearch` note above. Placed
            outside the `!hideButtons` group on purpose: that group is the
            dataset-management toolbar, and search is a way of reading the grid,
            not of managing the dataset. */}
        {datasetId && (
          <Box maxWidth="240px">
            <SearchInput
              size="sm"
              // `SearchInput` carries `role="searchbox"`, which keeps this
              // distinct from the grid's cell editors (`textbox`) for both
              // assistive tech and role-based queries.
              aria-label="Search rows"
              placeholder="Search rows"
              data-testid="dataset-row-search"
              value={searchInput}
              // Gated on pending writes for the same reason page navigation is:
              // a new search reloads the store, and an edit still on its way to
              // being saved refers to a row that reload drops — it would be
              // discarded with nothing shown. The autosave debounce is short.
              disabled={hasPendingWrites}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </Box>
        )}
        {!floatingSelectionBar && selectedRows.size > 0 && (
          <Button
            size="sm"
            colorPalette="red"
            variant="outline"
            data-testid="delete-selected-rows"
            onClick={() => deleteSelectedRows()}
          >
            <X size={14} /> Delete {selectedRows.size} {selectedRows.size === 1 ? "row" : "rows"}
          </Button>
        )}
        {!hideButtons && (
          <>
            <Button
              size="sm"
              variant="ghost"
              data-testid="download-csv"
              loading={downloadDataset.isPending}
              onClick={() => void downloadCSV()}
            >
              <Download size={16} /> Download as CSV
            </Button>
            {datasetId && !hasSearchTakenTheGrid && (
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
                activeDatasetId={datasetId ?? "in-memory"}
                isLoading={!!datasetId && databaseDataset.isLoading}
                shouldVirtualize={shouldVirtualize}
                disableVirtualization={false}
                displayRowCount={displayRowCount}
              />
            </tbody>
          </table>

          {/* A search with no matches leaves the grid empty (the phantom add-row
              is withdrawn, so `displayRowCount` is 0) — unreadable alone, since
              it looks like a dataset with no rows. Sits INSIDE the grid's
              border, held until the read settles so the message doesn't flash
              between keystrokes. */}
          {hasSearchFailed && (
            <Text
              fontSize="13px"
              color="fg.muted"
              paddingX={3}
              paddingY={4}
              data-testid="dataset-search-failed"
            >
              {searchFailedMessage(activeSearch)}
            </Text>
          )}

          {isSearching &&
            !hasSearchFailed &&
            !databaseDataset.isLoading &&
            !holdingPreviousData &&
            rowCount === 0 && (
              <Text
                fontSize="13px"
                color="fg.muted"
                paddingX={3}
                paddingY={4}
                data-testid="dataset-search-empty"
              >
                {noSearchMatchesMessage(activeSearch)}
              </Text>
            )}
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
      {datasetId && (
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
      )}
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

      {/* Withdrawn once a search owns the grid, for the same reason its toolbar
          button is: rows imported here land at the end of the dataset, outside
          the matches on screen. The effect above is what makes the withdrawal
          stick — unmounting alone would leave the disclosure believing it is
          still open, and clearing the search would bring it back. */}
      {datasetId && addRowsFromCSVModal.open && !hasSearchTakenTheGrid && (
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
export function SaveStatusChip({ state, error }: { state: AutosaveState; error?: string }) {
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
