import { Box } from "@chakra-ui/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useState } from "react";
import type { LensConfig } from "../../stores/viewStore";
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

  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);

  const table = useReactTable({
    data: traces,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
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
