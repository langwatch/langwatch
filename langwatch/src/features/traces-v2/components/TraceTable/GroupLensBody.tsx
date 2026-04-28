import { Flex, Text } from "@chakra-ui/react";
import {
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useMemo, useState } from "react";
import { type LensConfig, groupByForGrouping } from "../../stores/viewStore";
import type { TraceListItem } from "../../types/trace";
import { buildGroupColumns } from "./columns";
import {
  RegistryRow,
  type TraceGroup,
  buildGroups,
  groupRegistry,
} from "./registry";
import { TraceTableShell } from "./TraceTableShell";
import { useTraceTableVirtualizer } from "./useTraceTableVirtualizer";
import { VirtualSpacer } from "./VirtualSpacer";

const GROUP_MIN_WIDTH = "880px";

interface GroupLensBodyProps {
  traces: TraceListItem[];
  lens: LensConfig;
}

export const GroupLensBody: React.FC<GroupLensBodyProps> = ({
  traces,
  lens,
}) => {
  const groupBy = groupByForGrouping(lens.grouping);
  const groups = useMemo(
    () => (groupBy ? buildGroups(traces, groupBy) : []),
    [traces, groupBy],
  );
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);
  const columns = useMemo(
    () => (groupBy ? buildGroupColumns(lens.columns, groupBy) : []),
    [lens.columns, groupBy],
  );

  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.key,
  });

  const rows = table.getRowModel().rows;
  const colSpan = columns.length;
  const { virtualizer, paddingTop, paddingBottom } = useTraceTableVirtualizer({
    count: rows.length,
    addonCount: lens.addons.length,
  });
  const virtualItems = virtualizer.getVirtualItems();

  if (!groupBy || groups.length === 0) return <NoTracesToGroupMessage />;

  const toggleExpanded = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <TraceTableShell table={table} minWidth={GROUP_MIN_WIDTH}>
      <VirtualSpacer height={paddingTop} colSpan={colSpan} />
      {virtualItems.map((virtualItem) => {
        const row = rows[virtualItem.index];
        if (!row) return null;
        return (
          <RegistryRow<TraceGroup>
            key={row.id}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            tanstackRow={row}
            registry={groupRegistry}
            addons={lens.addons}
            status={row.original.worstStatus}
            hoverScope="split"
            isExpanded={openKeys.has(row.original.key)}
            onToggleExpand={() => toggleExpanded(row.original.key)}
          />
        );
      })}
      <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
    </TraceTableShell>
  );
};

const NoTracesToGroupMessage: React.FC = () => (
  <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
    <Text color="fg.muted" textStyle="sm">
      No traces to group.
    </Text>
  </Flex>
);
