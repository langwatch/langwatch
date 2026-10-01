import { useMemo } from "react";

import { api } from "../../../../behavior/automation-api.ts";
import { resolveSeriesLabel } from "../../../../model/graph-series.ts";

// Resolve human-facing graph name and series display label from saved JSON; returns null when
// graph is loading, unselected, or stored series key no longer matches.
export function useGraphAlertLabels({
  projectId,
  enabled,
  customGraphId,
  seriesName,
}: {
  projectId: string;
  enabled: boolean;
  customGraphId: string | null;
  seriesName: string;
}): { graphName: string | null; seriesLabel: string | null } {
  const graphQuery = api.graphs.getById.useQuery(
    { projectId, id: customGraphId ?? "" },
    { enabled: enabled && !!customGraphId && !!projectId },
  );
  const graphName = graphQuery.data?.name ?? null;
  const seriesLabel = useMemo(
    () => resolveSeriesLabel(graphQuery.data?.graph, seriesName),
    [graphQuery.data?.graph, seriesName],
  );
  return { graphName, seriesLabel };
}
