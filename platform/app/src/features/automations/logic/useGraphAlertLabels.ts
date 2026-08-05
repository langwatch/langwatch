import { useMemo } from "react";
import { api } from "~/utils/api";
import { resolveSeriesLabel } from "./seriesOptions";

/**
 * Resolves the human-facing names a graph alert renders with — the graph's
 * name and the monitored series' display label — from the selected graph's
 * saved JSON. Used by the drawer's preview / test-fire (honest example
 * copy) and the main-drawer conditions summary (no raw
 * `{index}/{key}/{aggregation}` keys in front of the user).
 *
 * Both return null while the graph is loading, when no graph is selected,
 * or when the stored series key no longer matches the graph — callers fall
 * back to placeholder copy or the raw key.
 */
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
