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
import { keepPreviousData } from "@tanstack/react-query";
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
import { useDebounce } from "use-debounce";
import { useStore } from "zustand";

import { AddOrEditDatasetDrawer } from "~/components/AddOrEditDatasetDrawer";
import { ColumnTypeIcon } from "~/components/shared/ColumnTypeIcon";
import { Pagination } from "~/components/ui/Pagination";
import { SearchInput } from "~/components/ui/SearchInput";
import { SelectionActionBar } from "~/components/ui/SelectionActionBar";
import { Tooltip } from "~/components/ui/tooltip";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "~/server/datasets/types";
import { api } from "~/utils/api";
import { AddRowsFromCSVModal } from "../AddRowsFromCSVModal";
import {
  type AutosaveState,
  type DatasetTableContextValue,
  DatasetTableProvider,
  type DatasetTableRowData,
} from "./DatasetTableContext";
import {
  formatSearchRecordCount,
  noSearchMatchesMessage,
  plainRecordCount,
  searchFailedMessage,
} from "./datasetEditorCopy";
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
/** Records per page for the saved-dataset editor (classic page N of M). One
 *  page comfortably fits the virtualized viewport while keeping each read
 *  bounded — an s3_jsonl page touches only the chunks overlapping the window. */
const DATASET_EDITOR_PAGE_SIZE = 50;

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

  // Saved datasets are read one page at a time (classic page N of M) instead of
  // the whole dataset, which previously truncated past a byte cap and silently
  // hid the rest. In-memory mode (no datasetId) keeps its full local copy.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DATASET_EDITOR_PAGE_SIZE);

  // ── Row search ────────────────────────────────────────────────────
  //
  // Paging is how you read a dataset in order and a poor way to find one row in
  // hundreds. The search is served by the same paged read: the server returns
  // the matching rows and a `count` of the matches, so the pager pages the
  // matches with no changes of its own.
  //
  // Saved datasets only. Narrowing an in-memory draft would mean filtering the
  // local store, and rows are addressed by their POSITION in it (`selectedRows`
  // is a Set of indices, `rowData` reads `records[index]`) — a filtered view
  // would leave a selection pointing at rows the user never picked. A draft is
  // also entirely on screen already, so there is nothing to search for.
  const [searchInput, setSearchInput] = useState("");
  // The term is debounced TOGETHER with the dataset it was typed against. A
  // bare-string debounce leaves the previous dataset's term in the debounced
  // value for 300ms after the user moves to another dataset without leaving the
  // editor — long enough to fetch the new dataset narrowed by a word that was
  // never typed against it. Pairing them lets the term be discarded the instant
  // it stops belonging to what is on screen, without waiting for the debounce.
  const searchScope = useMemo(
    () => ({ datasetId, text: searchInput }),
    [datasetId, searchInput],
  );
  const [debouncedSearch] = useDebounce(searchScope, 300);
  const activeSearch =
    datasetId && debouncedSearch.datasetId === datasetId
      ? debouncedSearch.text.trim() || undefined
      : undefined;
  const isSearching = !!activeSearch;

  // Where the user was before the search started, so clearing it puts them back
  // rather than on page 1 — see `onSearchChange` below, which maintains it.
  const pageBeforeSearch = useRef<number | undefined>(undefined);
  // The dataset's own total, remembered from its last unsearched read — see the
  // count derivation below, which maintains it.
  const unsearchedRecordCount = useRef<number | undefined>(undefined);

  // Search term, page and the remembered dataset total each describe ONE
  // dataset. The editor stays mounted when the user moves between datasets
  // client-side — the route param changes underneath it — so unless they are
  // dropped here they carry over: the new dataset opens narrowed by a word
  // typed against the old one, at a page it may not have, with the old one's
  // size on the count chip and nothing on screen explaining any of it.
  //
  // Reset during render, not in an effect: an effect runs after the render that
  // has already put the stale page into the query key, so the request for it
  // goes out regardless. `setData` clears the row selection when the new
  // dataset's rows land, so there is nothing to clear here.
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

  // The PG-authoritative total record count from the last settled read (undefined
  // until the first response; held across a page switch by keepPreviousData so it
  // never momentarily resets mid-navigation). Deriving the page count from
  // `count / pageSize` — rather than reading the server's `totalPages` — keeps it
  // correct the instant the user changes the rows-per-page, before any refetch.
  // `pageCount` floors at 1 so an EMPTY dataset still reads as a single page and
  // never asks for page 0 (which the server's `positive()` guard would reject).
  // `currentPage` is the page actually shown, clamped so it can never exceed the
  // count.
  const serverRecordCount = datasetId ? databaseDataset.data?.count : undefined;

  // While a search is in effect `count` is the number of MATCHES, so the
  // dataset's own total has to be remembered from the last unsearched read —
  // otherwise the header could only say how many rows matched, which reads as
  // the dataset having shrunk. The editor always loads unsearched first (the
  // box starts empty), so this is populated before any search can run.
  // While `keepPreviousData` serves the prior key's result during a key change,
  // `isPlaceholderData` is true. Skip hydrating from it: a `datasetId` switch
  // would otherwise populate the grid with the OLD dataset's rows under the NEW
  // id (a data-integrity mismatch until the new query settles). For a
  // same-dataset page switch this just holds the current page until the next one
  // lands.
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
  // Snap a now-out-of-range page back into range — e.g. the last page's rows
  // were all deleted under us (the post-delete refetch shrinks the count) or a
  // navigation refetch returned a smaller dataset. Acts ONLY on an authoritative
  // count — never on absent data, never on data held over from the previous
  // request, and never while the debounce is still catching up with the search
  // box — so an in-flight change can't bounce navigation back to page 1.
  //
  // That last guard is the one with teeth. Clearing a search restores the page
  // the user searched from, but `activeSearch` trails the input by the debounce,
  // so for those 300ms the count on hand is still the MATCH count. Without the
  // guard the clamp reads "page 3 of 1" and snaps a user who was three pages in
  // back to page 1 — undoing the restore it was meant to protect.
  //
  // Floored at 1, so it never drives the page to 0.
  const searchSettling = (searchInput.trim() || undefined) !== activeSearch;
  useEffect(() => {
    if (serverRecordCount == null || holdingPreviousData || searchSettling)
      return;
    const count = Math.max(1, Math.ceil(serverRecordCount / pageSize));
    if (page > count) setPage(count);
  }, [serverRecordCount, pageSize, page, holdingPreviousData, searchSettling]);

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
    if (datasetId && databaseDataset.data && !holdingPreviousData) {
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

  // Typing in the search box resets the page and drops the selection
  // IMMEDIATELY, before the debounce lets the search reach the query.
  //
  // Both have to happen ahead of the read, not after it. Resetting the page
  // afterwards fires a real request for (old page, new search) — a page that
  // usually does not exist within the matches, so it returns an empty one.
  // Dropping the selection afterwards is worse: rows are selected by their
  // POSITION (`selectedRows` holds indices, `deleteSelectedRows` filters by
  // index), so for the moment the new rows are in place under an old selection,
  // a delete would remove records the user never picked. Paging clears the
  // selection for the same reason.
  // Where the user was before the search started, so clearing it puts them back
  // rather than on page 1. Not cosmetic: the add-row affordances live on the
  // LAST page, so returning a multi-page dataset to page 1 would withdraw them
  // for the rest of the session — a search would silently cost the user their
  // place and their way of adding a row.
  // The bookkeeping is done HERE, in the event handler, and not inside a
  // `setPage` updater: React replays updaters in StrictMode to surface impurity,
  // and an updater that writes this ref reads it back as `undefined` on the
  // replay — so clearing a search would land on page 1 in development and on the
  // remembered page in production. Event handlers are not replayed.
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

  // ── Table assembly ────────────────────────────────────────────────

  const rowCount = records.length;
  // The trailing phantom row (Excel-style "click to add") appends to the END of
  // the dataset, so on the paged saved view it belongs only on the last page —
  // adding it on an earlier full page would create a row the user can't see.
  // In-memory mode (no datasetId) is one local list, so it always shows it.
  // ...and never while a search is in effect: a new row is empty, so it would
  // not match the search and would appear to vanish the moment it was created.
  // This one flag covers both the button and the phantom row (via
  // `displayRowCount`); the CSV import is withdrawn alongside them, for the same
  // reason — its rows land at the end of the dataset, outside the matches.
  const showAddRow = (!datasetId || isLastPage) && !isSearching;
  // A refused search leaves the rows read BEFORE it on screen: the store is only
  // written from a settled `data` (see the effect above), so an error leaves the
  // previous page in place. Those rows were never matched against the search,
  // and leaving them under a search box reads as "here is what matched" — a
  // complete, confident, false answer. Withdraw them and say what happened.
  const searchFailed = isSearching && !!databaseDatasetError;
  const displayRowCount = searchFailed
    ? 0
    : showAddRow
      ? Math.max(rowCount + 1, 3)
      : rowCount;

  // Block page navigation while a record save is queued or in flight: switching
  // pages reloads the store (setData drops the prior page's records), so an
  // unsaved edit on the outgoing page would be stranded (resolveFullRecord can
  // no longer find it). The autosave debounce is short, so this is a brief gate.
  const hasPendingWrites =
    autosave.state === "saving" ||
    (datasetId
      ? Object.keys(pendingSavedChanges[datasetId] ?? {}).length > 0
      : false);

  // The count chip shows the PG-authoritative whole-dataset total (`count`),
  // not just the rows on this page; the pager shows the position within it.
  // (Pagination replaced the old byte-cap truncation, so there is no longer a
  // partial-read state to surface.) `serverRecordCount` is derived once above.
  const totalRecordCount = serverRecordCount ?? rowCount;

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
      } catch (error) {
        showErrorToast({ error, fallbackTitle: "Couldn't download dataset" });
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
          {/* A refused search has no match count to report, and the count it
              would otherwise fall back to is the stale store's row count — the
              rows read before the search. Reporting either passes unsearched
              rows off as the result, so it reports the dataset's own size when
              that is known and says nothing when it is not. */}
          {searchFailed
            ? unsearchedRecordCount.current === undefined
              ? ""
              : plainRecordCount(unsearchedRecordCount.current)
            : isSearching
              ? formatSearchRecordCount({
                  matched: totalRecordCount,
                  total: unsearchedRecordCount.current,
                })
              : plainRecordCount(totalRecordCount)}
        </Text>
        {datasetId && (
          <SaveStatusChip state={autosave.state} error={autosave.error} />
        )}
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
              loading={downloadDataset.isPending}
              onClick={() => void downloadCSV()}
            >
              <Download size={16} /> Download as CSV
            </Button>
            {datasetId && !isSearching && (
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

          {/* A search with no matches leaves the grid empty: the phantom
              add-row is withdrawn during a search, so `displayRowCount` is 0
              and the body renders nothing. An empty grid alone is unreadable —
              it looks the same as a dataset that has no rows, and does not say
              which search produced it. Sits INSIDE the grid's border, where the
              missing rows would have been: below it, the reader gets a blank
              box with an unattached sentence under it. Held until the read
              settles so the message does not flash between keystrokes. */}
          {searchFailed && (
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
            !searchFailed &&
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
          <Button
            size="sm"
            variant="ghost"
            data-testid="add-row"
            onClick={handleAddRow}
          >
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

      {/* Withdrawn while a search is in effect for the same reason its toolbar
          button is: a click landing inside the search debounce opens this while
          `isSearching` is still false, and rows imported here land at the end of
          the dataset — outside the matches on screen. */}
      {datasetId && addRowsFromCSVModal.open && !isSearching && (
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
