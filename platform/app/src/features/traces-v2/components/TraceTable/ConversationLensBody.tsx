import { Flex, Text } from "@chakra-ui/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useConversationTurns } from "../../hooks/useConversationTurns";
import { useFilterStore } from "../../stores/filterStore";
import type { LensConfig } from "../../stores/viewStore";
import { mapTraceListPayload } from "../../utils/mapTraceListPayload";
import { buildConversationColumns } from "./columns";
import type { ConversationGroup } from "./conversationGroups";
import { conversationRegistry, RegistryRow } from "./registry";
import {
  EXPANDED_BG,
  EXPANDED_BG_CSS,
} from "./registry/addons/conversation/expandedTurnStyles";
import { conversationSelectColumnDef } from "./selectColumn";
import { buildConversationPlaceholderRows } from "./skeletonPlaceholders";
import { TraceTableShell } from "./TraceTableShell";
import { useTraceTableVirtualizer } from "./useTraceTableVirtualizer";
import { VirtualSpacer } from "./VirtualSpacer";

const CONVERSATION_MIN_WIDTH = "880px";

// Stable reference so RegistryRow's prop memo doesn't re-render every row
// each parent render. The expanded session's header row shares this
// recessed surface with its turn rows.
const EXPANDED_ROW_BG = { surface: EXPANDED_BG, firstCell: EXPANDED_BG_CSS };

interface ConversationLensBodyProps {
  /**
   * Server-grouped session rows (specs/traces-v2/sessions-lens.feature):
   * every total is the TRUE rollup over the whole time range, already in
   * lens sort order. Rows arrive without turn traces; the expanded row's
   * turns load lazily below.
   */
  groups: ConversationGroup[];
  lens: LensConfig;
  isLoading?: boolean;
}

export const ConversationLensBody: React.FC<ConversationLensBodyProps> = ({
  groups: realGroups,
  lens,
  isLoading = false,
}) => {
  const pageSize = useFilterStore((s) => s.pageSize);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Turn rows for the one expanded session, fetched on demand: the session
  // rollup is a GROUP BY, so the row itself carries no per-trace data. Same
  // conversation-scoped query the drawer's Conversation tab uses.
  const expandedTurnsQuery = useConversationTurns(
    isLoading ? null : expandedKey,
  );
  const expandedTurns = useMemo(
    () => mapTraceListPayload(expandedTurnsQuery.data),
    [expandedTurnsQuery.data],
  );

  const groups = useMemo(() => {
    if (isLoading) return buildConversationPlaceholderRows(pageSize);
    if (expandedKey === null || expandedTurns.length === 0) return realGroups;
    return realGroups.map((group) =>
      group.conversationId === expandedKey
        ? { ...group, traces: expandedTurns }
        : group,
    );
  }, [isLoading, pageSize, realGroups, expandedKey, expandedTurns]);

  const columns = useMemo(
    () => [
      conversationSelectColumnDef,
      ...buildConversationColumns(lens.columns),
    ],
    [lens.columns],
  );
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);
  // Keep the header sort indicators in sync with the lens sort: rows come
  // from the server already ordered by it, so without this the indicators
  // would drift out of sync with the rendered group order when the lens
  // changes.
  useEffect(() => {
    setSorting([
      { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
    ]);
  }, [lens.sort.columnId, lens.sort.direction]);

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

  if (!isLoading && groups.length === 0) return <NoSessionsMessage />;

  const toggleExpanded = (id: string) =>
    setExpandedKey((prev) => (prev === id ? null : id));

  return (
    <TraceTableShell
      table={table}
      minWidth={CONVERSATION_MIN_WIDTH}
      stickyFirstColumn
    >
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
            isExpanded={
              !isLoading && expandedKey === row.original.conversationId
            }
            expandedBg={EXPANDED_ROW_BG}
            onToggleExpand={
              isLoading
                ? undefined
                : () => toggleExpanded(row.original.conversationId)
            }
            isLoading={isLoading}
          />
        );
      })}
      <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
    </TraceTableShell>
  );
};

const NoSessionsMessage: React.FC = () => (
  <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
    <Text color="fg.muted" textStyle="sm">
      No sessions found.
    </Text>
    <Text textStyle="xs" color="fg.subtle">
      Sessions appear once your traces are grouped into conversations.
    </Text>
  </Flex>
);
