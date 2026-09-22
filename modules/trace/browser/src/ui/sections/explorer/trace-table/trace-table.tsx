import { Button } from "@chakra-ui/react";
import {
  type PageCursor,
  rowKindForGrouping,
  useEffectiveLens,
  useExplorerStore,
} from "@langwatch/trace-browser-kit";
import { requoteBareTerms } from "@langwatch/trace-contract";
import type React from "react";

import { HandledErrorState, readHandledError } from "../../errors/index.ts";
import { useExplorerCounts } from "../hooks/use-explorer-counts.ts";
import {
  SESSIONS_MAX_PAGE_SIZE,
  type SessionGroupsResult,
  useSessionGroups,
} from "../hooks/use-session-groups.ts";
import { useTraceList } from "../hooks/use-trace-list.ts";
import { ConversationLensBody } from "./conversation-lens-body.tsx";
import { EmptyFilterState } from "./empty-filter-state.tsx";
import { GroupLensBody } from "./group-lens-body.tsx";
import { TraceLensBody } from "./trace-lens-body.tsx";
import { TraceTableLayout } from "./trace-table-layout.tsx";

/**
 * What the table shell (totals copy, pagination, empty state) reads, from the
 * source the active lens paginates: the sessions lens walks its own grouped
 * rows, every other lens the traces. The total is `useExplorerCounts`'s.
 */
interface TableShell {
  totalHits: number;
  nextCursor: PageCursor | null;
  visibleCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isTransitioning: boolean;
  /**
   * A failed read has no rows either, and it must never be told as "nothing matched":
   * that sends someone off widening a filter to find data the filter was never the
   * problem with.
   */
  isError: boolean;
  error: unknown;
  itemNoun: string;
  maxPageSize?: number;
}

const sessionsShell = ({
  sessions,
  totalHits,
}: {
  sessions: SessionGroupsResult;
  totalHits: number;
}): TableShell => ({
  totalHits,
  nextCursor: sessions.nextCursor,
  visibleCount: sessions.groups.length,
  isLoading: sessions.isLoading,
  isFetching: sessions.isFetching,
  isTransitioning: sessions.isPlaceholderData,
  isError: sessions.isError,
  error: sessions.error,
  itemNoun: "conversations",
  maxPageSize: SESSIONS_MAX_PAGE_SIZE,
});

const tracesShell = (list: Omit<TableShell, "itemNoun" | "maxPageSize">): TableShell => ({
  ...list,
  itemNoun: "traces",
});

/**
 * What the table shell shows before it has rows to show: the failure if the read
 * failed, the empty state if it genuinely came back empty, and null when there is a
 * table to render.
 */
function shellPlaceholder(shell: TableShell): React.ReactNode | null {
  if (shell.isError) {
    return (
      <HandledErrorState
        error={shell.error}
        fallbackTitle={`We could not load your ${shell.itemNoun}`}
      >
        {readHandledError(shell.error)?.code === "filter_too_complex" && (
          <SearchAsOnePhraseAction />
        )}
      </HandledErrorState>
    );
  }
  const isEmpty =
    !shell.isFetching &&
    !shell.isTransitioning &&
    shell.visibleCount === 0 &&
    shell.totalHits === 0;
  return isEmpty ? <EmptyFilterState /> : null;
}

/**
 * The one-click fix for `filter_too_complex`: the bare words of the applied
 * query become one quoted phrase, the explicit terms stay, and the search runs
 * again.
 * @see specs/traces-v2/search.feature
 */
const SearchAsOnePhraseAction: React.FC = () => {
  const queryText = useExplorerStore((s) => s.queryText);
  const applyQueryText = useExplorerStore((s) => s.applyQueryText);
  const requoted = requoteBareTerms(queryText);
  if (requoted === queryText) return null;
  return (
    <Button
      size="sm"
      variant="surface"
      colorPalette="orange"
      onClick={() => applyQueryText(requoted)}
    >
      Search it as one phrase
    </Button>
  );
};

export const TraceTable: React.FC = () => {
  const {
    data: traces,
    nextCursor,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    error,
    newIds,
  } = useTraceList();
  // Sessions lens data source: server-side rollups per conversation id
  // (specs/traces-v2/sessions-lens.feature). The hook only queries while the
  // by-conversation grouping is active.
  const sessions = useSessionGroups();
  const { totalHits } = useExplorerCounts();
  const activeLens = useEffectiveLens();

  if (!activeLens) return <EmptyFilterState />;

  const rowKind = rowKindForGrouping(activeLens.grouping);
  const shell =
    rowKind === "conversation"
      ? sessionsShell({ sessions, totalHits })
      : tracesShell({
          totalHits,
          nextCursor,
          visibleCount: traces.length,
          isLoading,
          isFetching,
          isTransitioning: isPlaceholderData,
          isError,
          error,
        });

  const placeholder = shellPlaceholder(shell);
  if (placeholder) return placeholder;

  return (
    <TraceTableLayout
      nextCursor={shell.nextCursor}
      visibleCount={shell.visibleCount}
      isLoading={shell.isLoading}
      isTransitioning={shell.isTransitioning}
      isEmpty={shell.visibleCount === 0}
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
        <GroupLensBody traces={traces} lens={activeLens} isLoading={isLoading} />
      )}
      {rowKind === "trace" && (
        <TraceLensBody traces={traces} lens={activeLens} newIds={newIds} isLoading={isLoading} />
      )}
    </TraceTableLayout>
  );
};
