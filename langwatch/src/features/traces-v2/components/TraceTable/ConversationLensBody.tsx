import { Flex, Text } from "@chakra-ui/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useMemo, useState } from "react";
import type { LensConfig } from "../../stores/viewStore";
import type { TraceListItem } from "../../types/trace";
import { buildConversationColumns } from "./columns";
import {
  type ConversationGroup,
  groupTracesByConversation,
} from "./conversationGroups";
import { conversationRegistry, RegistryRow } from "./registry";
import { conversationSelectColumnDef } from "./selectColumn";
import { TraceTableShell } from "./TraceTableShell";
import { useTraceTableVirtualizer } from "./useTraceTableVirtualizer";
import { VirtualSpacer } from "./VirtualSpacer";

const CONVERSATION_MIN_WIDTH = "880px";

interface ConversationLensBodyProps {
  traces: TraceListItem[];
  lens: LensConfig;
}

export const ConversationLensBody: React.FC<ConversationLensBodyProps> = ({
  traces,
  lens,
}) => {
  const groups = useMemo(() => groupTracesByConversation(traces), [traces]);
  const columns = useMemo(
    () => [conversationSelectColumnDef, ...buildConversationColumns(lens.columns)],
    [lens.columns],
  );
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    enableSortingRemoval: false,
    getRowId: (row) => row.conversationId,
  });

  const rows = table.getRowModel().rows;
  const colSpan = columns.length;
  const { virtualizer, paddingTop, paddingBottom } = useTraceTableVirtualizer({
    count: rows.length,
    addonCount: lens.addons.length,
  });
  const virtualItems = virtualizer.getVirtualItems();

  if (groups.length === 0) return <NoConversationsMessage />;

  const toggleExpanded = (id: string) =>
    setExpandedKey((prev) => (prev === id ? null : id));

  return (
    <TraceTableShell table={table} minWidth={CONVERSATION_MIN_WIDTH}>
      <VirtualSpacer height={paddingTop} colSpan={colSpan} />
      {virtualItems.map((virtualItem) => {
        const row = rows[virtualItem.index];
        if (!row) return null;
        return (
          <RegistryRow<ConversationGroup>
            key={row.id}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            tanstackRow={row}
            registry={conversationRegistry}
            addons={lens.addons}
            status={row.original.worstStatus}
            hoverScope="split"
            isExpanded={expandedKey === row.original.conversationId}
            onToggleExpand={() => toggleExpanded(row.original.conversationId)}
          />
        );
      })}
      <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
    </TraceTableShell>
  );
};

const NoConversationsMessage: React.FC = () => (
  <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
    <Text color="fg.muted" textStyle="sm">
      No conversations found.
    </Text>
    <Text textStyle="xs" color="fg.subtle">
      Conversations appear when traces include a conversation ID.
    </Text>
  </Flex>
);
