import type React from "react";
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
  const { data: traces, totalHits, isLoading, isFetching, isPreviousData, newIds } = useTraceList();
  const activeLens = useViewStore(getEffectiveLens);

  if (!activeLens) return <EmptyFilterState />;
  // Gate EmptyFilterState on true emptiness: only render it when no fetch is
  // in flight and the data is settled (not showing previous-key stale rows).
  // This prevents flashing EmptyFilterState during transitional fetches where
  // `keepPreviousData` may hold the empty result from a prior key.
  if (!isFetching && !isPreviousData && traces.length === 0) return <EmptyFilterState />;

  const rowKind = rowKindForGrouping(activeLens.grouping);

  return (
    <TraceTableLayout totalHits={totalHits} isLoading={isLoading} isEmpty={traces.length === 0}>
      {rowKind === "conversation" && (
        <ConversationLensBody
          traces={traces}
          lens={activeLens}
          isLoading={isLoading}
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
