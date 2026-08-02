import type React from "react";
import {
  SESSIONS_MAX_PAGE_SIZE,
  useSessionGroups,
} from "../../hooks/useSessionGroups";
import { useTraceList } from "../../hooks/useTraceList";
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
  const isSessionsLens = rowKind === "conversation";

  // Gate EmptyFilterState on true emptiness: only render it when no fetch is
  // in flight and the data is settled (not showing previous-key stale rows).
  // This prevents flashing EmptyFilterState during transitional fetches where
  // `keepPreviousData` may hold the empty result from a prior key. The
  // sessions lens gates on its own query for the same reason.
  const isEmpty = isSessionsLens
    ? !sessions.isFetching &&
      !sessions.isPreviousData &&
      sessions.groups.length === 0 &&
      sessions.totalHits === 0
    : !isFetching && !isPreviousData && traces.length === 0 && totalHits === 0;
  if (isEmpty) return <EmptyFilterState />;

  return (
    <TraceTableLayout
      totalHits={isSessionsLens ? sessions.totalHits : totalHits}
      nextCursor={isSessionsLens ? sessions.nextCursor : nextCursor}
      visibleCount={isSessionsLens ? sessions.groups.length : traces.length}
      isLoading={isSessionsLens ? sessions.isLoading : isLoading}
      isTransitioning={
        isSessionsLens ? sessions.isPreviousData : isPreviousData
      }
      isEmpty={
        isSessionsLens ? sessions.groups.length === 0 : traces.length === 0
      }
      itemNoun={isSessionsLens ? "sessions" : "traces"}
      maxPageSize={isSessionsLens ? SESSIONS_MAX_PAGE_SIZE : undefined}
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
