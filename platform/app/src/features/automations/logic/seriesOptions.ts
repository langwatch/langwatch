import { deriveSeriesIdentifier } from "~/components/analytics/seriesIdentifier";

/** A pickable series on a custom graph: the canonical
 *  `{index}/{key|metric}/{aggregation}` key plus the human label the
 *  author sees. */
export interface GraphSeriesOption {
  key: string;
  label: string;
}

/**
 * Builds the series-key + label list a custom graph's JSON exposes for
 * alert authoring. Matches the format the dispatcher reads ("`{index}/{key
 * | metric}/{aggregation}`") so the saved `seriesName` lines up with what
 * the chart data is keyed by at evaluation time.
 *
 * Defensive: a hand-edited / malformed `graph` JSON falls back to an empty
 * list so callers still render without crashing — the series picker just
 * shows no options and the summary falls back to the raw key.
 */
export function deriveSeriesOptionsFromGraph(
  graph: unknown,
): GraphSeriesOption[] {
  if (!graph || typeof graph !== "object") return [];
  const candidate = (graph as { series?: unknown }).series;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((entry, index): GraphSeriesOption | null => {
      const seriesKey = deriveSeriesIdentifier(graph, index);
      if (!seriesKey) return null;
      const s = (entry ?? {}) as Record<string, unknown>;
      const tail = seriesKey.split("/").slice(1).join(" / ");
      const label =
        (typeof s.name === "string" && s.name.length > 0 ? s.name : null) ??
        `Series ${index + 1}: ${tail}`;
      return { key: seriesKey, label };
    })
    .filter((o): o is GraphSeriesOption => o !== null);
}

/**
 * Resolves the human label for a stored series key against a graph's JSON.
 * Returns null when the graph is missing or the key doesn't match any of
 * its series (deleted / re-ordered series) — callers fall back to the raw
 * key or their own placeholder copy.
 */
export function resolveSeriesLabel(
  graph: unknown,
  seriesKey: string,
): string | null {
  if (!seriesKey) return null;
  return (
    deriveSeriesOptionsFromGraph(graph).find((o) => o.key === seriesKey)
      ?.label ?? null
  );
}
