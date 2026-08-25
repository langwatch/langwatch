import {
  deriveSeriesIdentifier,
  graphSeriesCollectionSchema,
} from "@langwatch/automation-contract";

/** A pickable series on a custom graph. */
export interface GraphSeriesOption {
  key: string;
  label: string;
}

/**
 * Builds the stored series key and human label for graph-alert authoring.
 * Malformed graph JSON produces no options so the authoring surface stays
 * usable and can fall back to the raw stored key.
 */
export function deriveSeriesOptionsFromGraph(graph: unknown): GraphSeriesOption[] {
  const parsed = graphSeriesCollectionSchema.safeParse(graph);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.series.flatMap((series, index) => {
    const key = deriveSeriesIdentifier(parsed.data, index);
    if (!key) {
      return [];
    }

    const tail = key.split("/").slice(1).join(" / ");
    const label =
      typeof series.name === "string" && series.name.length > 0
        ? series.name
        : `Series ${index + 1}: ${tail}`;
    return [{ key, label }];
  });
}

/** Resolves a stored series key against a graph's current JSON. */
export function resolveSeriesLabel(graph: unknown, seriesKey: string): string | null {
  if (!seriesKey) {
    return null;
  }

  return (
    deriveSeriesOptionsFromGraph(graph).find((option) => option.key === seriesKey)
      ?.label ?? null
  );
}
