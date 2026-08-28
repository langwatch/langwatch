import { Flex, Text } from "@chakra-ui/react";
import {
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useConversationTurns } from "../../hooks/useConversationTurns";
import type { LensConfig } from "@langwatch/trace-web";
import { useDrawerStore, useFilterStore } from "@langwatch/trace-web";
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

const CONVERSATION_MIN_WIDTH = "1000px";

// Stable reference so RegistryRow's prop memo doesn't re-render every row
// each parent render. The expanded conversation's header row shares this
// recessed surface with its turn rows.
const EXPANDED_ROW_BG = { surface: EXPANDED_BG, firstCell: EXPANDED_BG_CSS };

interface ConversationLensBodyProps {
  /**
   * Server-grouped conversation rows (specs/traces-v2/sessions-lens.feature):
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
  const openLatestTrace = useOpenLatestTrace();

  // Turn rows for the one expanded conversation, fetched on demand: the
  // rollup is a GROUP BY, so the row itself carries no per-trace data. Same
  // conversation-scoped query the drawer's Conversation tab uses.
  const expandedTurnsQuery = useConversationTurns(isLoading ? null : expandedKey);
  const expandedTurns = useMemo(
    () => mapTraceListPayload(expandedTurnsQuery.data),
    [expandedTurnsQuery.data],
  );

  const groups = useMemo(() => {
    if (isLoading) return buildConversationPlaceholderRows(pageSize);
    if (expandedKey === null || expandedTurns.length === 0) return realGroups;
    return realGroups.map((group) =>
      group.conversationId === expandedKey ? { ...group, traces: expandedTurns } : group,
    );
  }, [isLoading, pageSize, realGroups, expandedKey, expandedTurns]);

  const columns = useMemo(
    () => [conversationSelectColumnDef, ...buildConversationColumns(lens.columns)],
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
    setSorting([{ id: lens.sort.columnId, desc: lens.sort.direction === "desc" }]);
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

  if (!isLoading && groups.length === 0) return <NoConversationsMessage />;

  const toggleExpanded = (id: string) =>
    setExpandedKey((prev) => (prev === id ? null : id));

  return (
    <TraceTableShell table={table} minWidth={CONVERSATION_MIN_WIDTH} stickyFirstColumn>
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
            isExpanded={!isLoading && expandedKey === row.original.conversationId}
            expandedBg={EXPANDED_ROW_BG}
            // A click on the row opens the conversation's latest trace; the
            // chevron is what expands its turns inline (RegistryRow prefers
            // `onSelect` for the row click, and the chevron stops
            // propagation). A row with no `lastTraceId` on it expands on click
            // instead, so it stays usable rather than becoming dead surface.
            onSelect={
              isLoading || !row.original.lastTraceId
                ? undefined
                : () => openLatestTrace(row.original)
            }
            onToggleExpand={
              isLoading ? undefined : () => toggleExpanded(row.original.conversationId)
            }
            isLoading={isLoading}
          />
        );
      })}
      <VirtualSpacer height={paddingBottom} colSpan={colSpan} />
    </TraceTableShell>
  );
};

/**
 * Open a conversation's most recent trace in the trace drawer.
 *
 * The light path on purpose: a conversation row is a rollup, not a trace, so
 * there is no row data to seed the drawer's caches with the way the trace lens
 * does. The store push before the route change is what lets the drawer's hooks
 * render against the right trace on the very next frame; the drawer fetches
 * the rest itself.
 */
function useOpenLatestTrace(): (group: ConversationGroup) => void {
  const { openDrawer } = useDrawer();

  return useCallback(
    (group: ConversationGroup) => {
      const traceId = group.lastTraceId;
      if (!traceId) return;
      const occurredAtMs = group.latestTimestamp;
      useDrawerStore.getState().openTrace(traceId, occurredAtMs);
      openDrawer("traceV2Details", {
        traceId,
        // `t` (timestamp) is the partition-pruning hint the drawer's reads
        // take, so opening on a conversation's last activity does not walk
        // every weekly partition by id.
        t: String(occurredAtMs),
      });
    },
    [openDrawer],
  );
}

const NoConversationsMessage: React.FC = () => (
  <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
    <Text color="fg.muted" textStyle="sm">
      No conversations found.
    </Text>
    <Text textStyle="xs" color="fg.subtle">
      Conversations appear once your traces carry a conversation identifier.
    </Text>
  </Flex>
);
