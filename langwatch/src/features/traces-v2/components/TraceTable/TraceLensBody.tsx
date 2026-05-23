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
import {
  getColumnSizingKey,
  useColumnSizingStore,
} from "../../stores/columnSizingStore";
import { useFilterStore } from "../../stores/filterStore";
import { type LensConfig, useViewStore } from "../../stores/viewStore";
import type { TraceListItem } from "../../types/trace";
import { RegistryRow } from "./registry";
import { buildTracePlaceholderRows } from "./skeletonPlaceholders";
import { TraceStatisticsProvider } from "./traceStatisticsContext";
import { TraceTableShell } from "./TraceTableShell";
import { useTraceLensColumns } from "./useTraceLensColumns";
import { useTraceLensKeyboard } from "./useTraceLensKeyboard";
import { useTraceTableVirtualizer } from "./useTraceTableVirtualizer";
import { VirtualSpacer } from "./VirtualSpacer";

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
  const { columns, registry, minWidth } = useTraceLensColumns({
    logicalColumnIds: lens.columns,
  });
  const {
    selectedTraceId,
    focusedIndex,
    expandedTraceId,
    toggleTrace,
    togglePeek,
    handleKeyDown,
  } = useTraceLensKeyboard({ traces });

  const sortFromStore = useViewStore((s) => s.sort);
  const setSortInStore = useViewStore((s) => s.setSort);

  const sizingKey = getColumnSizingKey(lens.id, "trace");
  const persistedSizing = useColumnSizingStore(
    (s) => s.byKey[sizingKey] ?? null,
  );
  const setSizing = useColumnSizingStore((s) => s.setSizing);
  const columnSizing = useMemo<ColumnSizingState>(
    () => persistedSizing ?? {},
    [persistedSizing],
  );
  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      const next =
        typeof updater === "function" ? updater(columnSizing) : updater;
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

  const table = useReactTable({
    data: effectiveTraces,
    columns,
    state: { sorting, columnSizing },
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

  // Precompute "is this the leading row of a consecutive error run?"
  // for every row. Done once per render in O(n) instead of having each
  // RegistryRow probe its neighbour. The flag drives the matching red
  // top border that closes the run on the upper side — without it,
  // the first error row's top edge is the previous (non-error) row's
  // grey bottom border, which looks "open on top".
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
        <TraceTableShell table={table} minWidth={minWidth}>
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
                isSelected={
                  !isLoading && row.original.traceId === selectedTraceId
                }
                isFocused={!isLoading && virtualItem.index === focusedIndex}
                isExpanded={
                  !isLoading && row.original.traceId === expandedTraceId
                }
                isNew={!isLoading && newIds.has(row.original.traceId)}
                rowDomId={row.original.traceId}
                onSelect={
                  isLoading ? undefined : () => toggleTrace(row.original)
                }
                onTogglePeek={
                  isLoading
                    ? undefined
                    : () => togglePeek(row.original.traceId)
                }
                isLoading={isLoading}
                isFirstOfErrorRun={
                  !isLoading && isFirstOfErrorRun[virtualItem.index]
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
