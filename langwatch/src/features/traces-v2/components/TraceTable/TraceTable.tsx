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
import { TraceTableSkeleton } from "./TraceTableSkeleton";

export const TraceTable: React.FC = () => {
  const { data: traces, totalHits, isLoading, newIds } = useTraceList();
  const activeLens = useViewStore(getEffectiveLens);

  if (isLoading) return <TraceTableSkeleton />;
  if (!activeLens) return <EmptyFilterState />;
  if (traces.length === 0) return <EmptyFilterState />;

  const rowKind = rowKindForGrouping(activeLens.grouping);

  return (
    <TraceTableLayout totalHits={totalHits}>
      {rowKind === "conversation" && (
        <ConversationLensBody traces={traces} lens={activeLens} />
      )}
      {rowKind === "group" && (
        <GroupLensBody traces={traces} lens={activeLens} />
      )}
      {rowKind === "trace" && (
        <TraceLensBody traces={traces} lens={activeLens} newIds={newIds} />
      )}
    </TraceTableLayout>
  );
};
