import type React from "react";
import { HandledErrorState } from "~/features/errors";
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
  /**
   * A failed read has no rows either, and it must never be told as "nothing
   * matched": that sends someone off widening a filter to find data the
   * filter was never the problem with. Carried here so the shell can say so
   * before the empty state gets the chance.
   */
  isError: boolean;
  error: unknown;
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
  isError: sessions.isError,
  error: sessions.error,
  itemNoun: "conversations",
  maxPageSize: SESSIONS_MAX_PAGE_SIZE,
});

const tracesShell = (
  list: Omit<TableShell, "itemNoun" | "maxPageSize">,
): TableShell => ({ ...list, itemNoun: "traces" });

/**
 * What the table shell shows before it has rows to show: the failure if the
 * read failed, the empty state if it genuinely came back empty, and null when
 * there is a table to render.
 *
 * The order is the point. A failed read has no rows either, and reporting it
 * as "nothing matched" sends someone off widening a filter that was never the
 * problem. Emptiness is only trusted once nothing is in flight and no stale
 * previous-key rows are standing in, or the empty state flashes mid-fetch.
 */
function shellPlaceholder(shell: TableShell): React.ReactNode | null {
  if (shell.isError) {
    return (
      <HandledErrorState
        error={shell.error}
        fallbackTitle={`We could not load your ${shell.itemNoun}`}
      />
    );
  }
  const isEmpty =
    !shell.isFetching &&
    !shell.isTransitioning &&
    shell.visibleCount === 0 &&
    shell.totalHits === 0;
  return isEmpty ? <EmptyFilterState /> : null;
}

export const TraceTable: React.FC = () => {
  const {
    data: traces,
    totalHits,
    nextCursor,
    isLoading,
    isFetching,
    isPreviousData,
    isError,
    error,
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
          isError,
          error,
        });

  const placeholder = shellPlaceholder(shell);
  if (placeholder) return placeholder;

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
