import { Box } from "@chakra-ui/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useCallback, useMemo } from "react";
import { type LensConfig, useViewStore } from "../../stores/viewStore";
import type { TraceListItem } from "../../types/trace";
import { RegistryRow } from "./registry";
import { TraceTableShell } from "./TraceTableShell";
import { useTraceLensColumns } from "./useTraceLensColumns";
import { useTraceLensKeyboard } from "./useTraceLensKeyboard";
import { useTraceTableVirtualizer } from "./useTraceTableVirtualizer";
import { VirtualSpacer } from "./VirtualSpacer";

interface TraceLensBodyProps {
  traces: TraceListItem[];
  lens: LensConfig;
  newIds: Set<string>;
}

export const TraceLensBody: React.FC<TraceLensBodyProps> = ({
  traces,
  lens,
  newIds,
}) => {
  const { columns, registry, minWidth } = useTraceLensColumns({
    logicalColumnIds: lens.columns,
    traces,
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
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
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
    data: traces,
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
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

  const { virtualizer, paddingTop, paddingBottom } = useTraceTableVirtualizer({
    count: rows.length,
    addonCount: lens.addons.length,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <Box tabIndex={0} onKeyDown={handleKeyDown} outline="none" height="full">
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
              isSelected={row.original.traceId === selectedTraceId}
              isFocused={virtualItem.index === focusedIndex}
              isExpanded={row.original.traceId === expandedTraceId}
              isNew={newIds.has(row.original.traceId)}
              rowDomId={row.original.traceId}
              onSelect={() => toggleTrace(row.original)}
              onTogglePeek={() => togglePeek(row.original.traceId)}
            />
          );
        })}
        <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
      </TraceTableShell>
    </Box>
  );
};
