import { Box } from "@chakra-ui/react";
import {
  type ColumnSizingState,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useCallback, useMemo } from "react";
import { traceContextChip } from "@langwatch/langy-web";
import { useEvaluatorOptions } from "../hooks/use-evaluator-options";
import type { LensConfig } from "../../../../index";
import {
  getColumnSizingKey,
  useColumnSizingStore,
  useFilterStore,
  useViewStore,
} from "../../../../index";
import type { TraceListItem } from "../types/trace";
import { ADD_COLUMN_ID } from "./add-column-header";
import { RegistryRow } from "./registry";
import { SELECT_COLUMN_ID } from "./registry/cells/select-cells";

/**
 * Module-level singleton so the `pinnedColumnIds` prop is referentially stable across renders — without it, every
 * render would hand the shell a new Set and the SortableContext would treat its items as having changed, kicking
 * off unnecessary re-mounts of the header row.
 */
const NON_REORDERABLE_COLUMN_IDS = new Set([SELECT_COLUMN_ID, ADD_COLUMN_ID]);

import type { TraceTableMeta } from "./select-column";
import { buildTracePlaceholderRows } from "./skeleton-placeholders";
import { TraceTableShell } from "./trace-table-shell";
import { TraceStatisticsProvider } from "./trace-statistics-context";
import { useTraceLensColumns } from "./use-trace-lens-columns";
import { useTraceLensKeyboard } from "./use-trace-lens-keyboard";
import { useTraceTableVirtualizer } from "./use-trace-table-virtualizer";
import { VirtualSpacer } from "../../../blocks/explorer/trace-table/virtual-spacer";

interface TraceLensBodyProps {
  traces: TraceListItem[];
  lens: LensConfig;
  newIds: Set<string>;
  /**
   * When set, render skeleton placeholder rows through the real table
   * shell so the loading state matches the eventual data layout (column
   * widths, addon rows, paddings). See `SkeletonCellContent`.
   */
  isLoading?: boolean;
}

export const TraceLensBody: React.FC<TraceLensBodyProps> = ({
  traces,
  lens,
  newIds,
  isLoading = false,
}) => {
  // Substitute synthetic rows while loading so the real table builds
  // the same column tree + addon rows we'll see once data lands. We
  // render exactly `pageSize` placeholders so the loading state fills
  // the same vertical space the real page will occupy — no awkward
  // half-filled table while the request is in flight.
  const pageSize = useFilterStore((s) => s.pageSize);
  const effectiveTraces = useMemo(
    () => (isLoading ? buildTracePlaceholderRows(pageSize) : traces),
    [isLoading, pageSize, traces],
  );
  const { nameByKey: evaluatorNames } = useEvaluatorOptions();
  const { columns, registry, minWidth } = useTraceLensColumns({
    logicalColumnIds: lens.columns,
    evaluatorNames,
  });
  const { selectedTraceId, focusedIndex, expandedTraceId, toggleTrace, togglePeek, handleKeyDown } =
    useTraceLensKeyboard({ traces });

  const sortFromStore = useViewStore((s) => s.sort);
  const setSortInStore = useViewStore((s) => s.setSort);
  const setVisibleColumns = useViewStore((s) => s.setVisibleColumns);

  const sizingKey = getColumnSizingKey(lens.id, "trace");
  const persistedSizing = useColumnSizingStore((s) => s.byKey[sizingKey] ?? null);
  const setSizing = useColumnSizingStore((s) => s.setSizing);
  const columnSizing = useMemo<ColumnSizingState>(() => persistedSizing ?? {}, [persistedSizing]);
  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      setSizing(sizingKey, next);
    },
    [columnSizing, sizingKey, setSizing],
  );

  const sorting = useMemo<SortingState>(
    () => [
      {
        id: sortFromStore.columnId,
        desc: sortFromStore.direction === "desc",
      },
    ],
    [sortFromStore],
  );

  // Dropping the keyset cursors is `setSort`'s own job — a cursor is only
  // valid for the column that minted it, and that invariant has to hold for
  // every path into a new sort, not just this header click.
  const handleSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) return;
      setSortInStore({
        columnId: first.id,
        direction: first.desc ? "desc" : "asc",
      });
    },
    [sorting, setSortInStore],
  );

  // Surface `columnOrder` as explicit Tanstack state.
  const columnOrderState = useMemo<string[]>(
    () => [SELECT_COLUMN_ID, ...lens.columns, ADD_COLUMN_ID],
    [lens.columns],
  );

  // The header cells only see the table, and a placeholder row is
  // indistinguishable from a real one once it is inside Tanstack's row model.
  // `meta` is how the select header learns the page is still loading and holds
  // its "select all" back. See `TraceTableMeta`.
  const tableMeta = useMemo<TraceTableMeta>(() => ({ isLoading }), [isLoading]);

  const table = useReactTable({
    data: effectiveTraces,
    columns,
    meta: tableMeta,
    state: { sorting, columnSizing, columnOrder: columnOrderState },
    onSortingChange: handleSortingChange,
    onColumnSizingChange: handleColumnSizingChange,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    // Cycle is asc → desc → asc; without this, the third click hits the
    // clear-sort branch which our handler ignores, leaving the column
    // stuck on desc.
    enableSortingRemoval: false,
    getRowId: (row) => row.traceId,
  });

  const rows = table.getRowModel().rows;
  const colSpan = columns.length;

  // Precompute "is this the leading row of a consecutive error run?" for every row.
  // Done once per render in O(n) instead of having each RegistryRow probe its
  // neighbour.
  const isFirstOfErrorRun = useMemo(() => {
    const flags = new Array<boolean>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const status = rows[i]!.original.status;
      flags[i] = status === "error" && rows[i - 1]?.original.status !== "error";
    }
    return flags;
  }, [rows]);

  const { virtualizer, paddingTop, paddingBottom } = useTraceTableVirtualizer({
    count: rows.length,
    addonCount: lens.addons.length,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <Box tabIndex={0} onKeyDown={handleKeyDown} outline="none" height="full">
      <TraceStatisticsProvider traces={traces} skip={isLoading}>
        {/* stickyFirstColumn pins the leftmost cell (the row-checkbox) so
            the select target stays reachable during horizontal scroll —
            the user can still tick a row off-screen without scrolling
            back to the start. The wider column set (TIMESTAMP, etc.)
            makes horizontal overflow the common case rather than the
            edge case it used to be. */}
        <TraceTableShell
          table={table}
          minWidth={minWidth}
          stickyFirstColumn
          // Persist drag-reorder via viewStore.setVisibleColumns. The
          // shell passes the new ordered list of column ids excluding
          // the select column (pinned via pinnedColumnIds); the store
          // marks the active lens dirty so the change shows up in
          // the "save lens" affordance.
          onColumnReorder={setVisibleColumns}
          pinnedColumnIds={NON_REORDERABLE_COLUMN_IDS}
        >
          <VirtualSpacer height={paddingTop} colSpan={colSpan} />
          {virtualItems.map((virtualItem) => {
            const row = rows[virtualItem.index];
            if (!row) return null;
            return (
              <RegistryRow
                key={row.id}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                tanstackRow={row}
                registry={registry}
                addons={lens.addons}
                status={row.original.status}
                hoverScope="unified"
                isSelected={!isLoading && row.original.traceId === selectedTraceId}
                isFocused={!isLoading && virtualItem.index === focusedIndex}
                isExpanded={!isLoading && row.original.traceId === expandedTraceId}
                isNew={!isLoading && newIds.has(row.original.traceId)}
                rowDomId={row.original.traceId}
                onSelect={isLoading ? undefined : () => toggleTrace(row.original)}
                onTogglePeek={isLoading ? undefined : () => togglePeek(row.original.traceId)}
                isLoading={isLoading}
                isFirstOfErrorRun={!isLoading && isFirstOfErrorRun[virtualItem.index]}
                // A trace row IS a trace, so it offers itself to Langy like any other
                // addressable resource on the page.
                langyTarget={
                  isLoading
                    ? null
                    : traceContextChip(row.original.traceId, row.original.name ?? null)
                }
              />
            );
          })}
          <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
        </TraceTableShell>
      </TraceStatisticsProvider>
    </Box>
  );
};
