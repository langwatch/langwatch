import type React from "react";
import {
  SESSIONS_MAX_PAGE_SIZE,
  type SessionGroupsResult,
  useSessionGroups,
} from "../../hooks/useSessionGroups";
import { useTraceList } from "../../hooks/useTraceList";
import type { PageCursor } from "../../stores/filterStore";
import {
  getEffectiveLens,
  rowKindForGrouping,
  useViewStore,
} from "../../stores/viewStore";
import { ConversationLensBody } from "./ConversationLensBody";
import { EmptyFilterState } from "./EmptyFilterState";
import { GroupLensBody } from "./GroupLensBody";
import { TraceLensBody } from "./TraceLensBody";
import { TraceTableLayout } from "./TraceTableLayout";

/**
 * What the table shell (totals copy, pagination, empty state) reads, from
 * whichever data source the active lens paginates: the sessions lens walks
 * its own server-grouped rows, every other lens walks the traces.
 */
interface TableShell {
  totalHits: number;
  nextCursor: PageCursor | null;
  visibleCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isTransitioning: boolean;
  itemNoun: string;
  maxPageSize?: number;
}

const sessionsShell = (sessions: SessionGroupsResult): TableShell => ({
  totalHits: sessions.totalHits,
  nextCursor: sessions.nextCursor,
  visibleCount: sessions.groups.length,
  isLoading: sessions.isLoading,
  isFetching: sessions.isFetching,
  isTransitioning: sessions.isPreviousData,
  itemNoun: "sessions",
  maxPageSize: SESSIONS_MAX_PAGE_SIZE,
});

const tracesShell = (
  list: Omit<TableShell, "itemNoun" | "maxPageSize">,
): TableShell => ({ ...list, itemNoun: "traces" });

export const TraceTable: React.FC = () => {
  const {
    data: traces,
    totalHits,
    nextCursor,
    isLoading,
    isFetching,
    isPreviousData,
    newIds,
  } = useTraceList();
  // Sessions lens data source: server-side rollups per conversation id
  // (specs/traces-v2/sessions-lens.feature). The hook only queries while the
  // by-conversation grouping is active.
  const sessions = useSessionGroups();
  const activeLens = useViewStore(getEffectiveLens);

  if (!activeLens) return <EmptyFilterState />;

  const rowKind = rowKindForGrouping(activeLens.grouping);
  const shell =
    rowKind === "conversation"
      ? sessionsShell(sessions)
      : tracesShell({
          totalHits,
          nextCursor,
          visibleCount: traces.length,
          isLoading,
          isFetching,
          isTransitioning: isPreviousData,
        });

  // Gate EmptyFilterState on true emptiness: only render it when no fetch is
  // in flight and the data is settled (not showing previous-key stale rows).
  // This prevents flashing EmptyFilterState during transitional fetches where
  // `keepPreviousData` may hold the empty result from a prior key.
  const isEmpty =
    !shell.isFetching &&
    !shell.isTransitioning &&
    shell.visibleCount === 0 &&
    shell.totalHits === 0;
  if (isEmpty) return <EmptyFilterState />;

  return (
    <TraceTableLayout
      totalHits={shell.totalHits}
      nextCursor={shell.nextCursor}
      visibleCount={shell.visibleCount}
      isLoading={shell.isLoading}
      isTransitioning={shell.isTransitioning}
      isEmpty={shell.visibleCount === 0}
      itemNoun={shell.itemNoun}
      maxPageSize={shell.maxPageSize}
    >
      {rowKind === "conversation" && (
        <ConversationLensBody
          groups={sessions.groups}
          lens={activeLens}
          isLoading={sessions.isLoading}
        />
      )}
      {rowKind === "group" && (
        <GroupLensBody
          traces={traces}
          lens={activeLens}
          isLoading={isLoading}
        />
      )}
      {rowKind === "trace" && (
        <TraceLensBody
          traces={traces}
          lens={activeLens}
          newIds={newIds}
          isLoading={isLoading}
        />
      )}
    </TraceTableLayout>
  );
};
