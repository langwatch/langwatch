import type React from "react";
import { useTraceList } from "../../hooks/useTraceList";
import { rowKindForGrouping, useViewStore } from "../../stores/viewStore";
import { ConversationLensBody } from "./ConversationLensBody";
import { EmptyFilterState } from "./EmptyFilterState";
import { GroupLensBody } from "./GroupLensBody";
import { TraceLensBody } from "./TraceLensBody";
import { TraceTableLayout } from "./TraceTableLayout";
import { TraceTableSkeleton } from "./TraceTableSkeleton";

export const TraceTable: React.FC = () => {
  const { data: traces, totalHits, isLoading, newIds } = useTraceList();
  const activeLens = useViewStore(
    (s) => s.allLenses.find((l) => l.id === s.activeLensId) ?? s.allLenses[0]!,
  );

  if (isLoading) return <TraceTableSkeleton />;
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
