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
  const { data: traces, totalHits, isLoading, newIds } = useTraceList();
  const activeLens = useViewStore(getEffectiveLens);

  if (!activeLens) return <EmptyFilterState />;
  // No lens-config / no-results states still get the dedicated empty
  // surface, but the skeleton path now flows through the *real* lens
  // body so column widths, addon rows, paddings, and pagination all
  // match exactly when data lands. No more layout jump on first paint.
  if (!isLoading && traces.length === 0) return <EmptyFilterState />;

  const rowKind = rowKindForGrouping(activeLens.grouping);

  return (
    <TraceTableLayout totalHits={totalHits} isLoading={isLoading}>
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
