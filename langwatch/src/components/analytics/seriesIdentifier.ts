/**
 * Canonical series identifier shared by every entry point into the
 * automations drawer that opens in graph-alert mode.
 *
 * The threshold rule the automations drawer stores against a custom
 * graph is keyed off `"{index}/{key|metric}/{aggregation}"` — the same
 * shape `FiltersSecondaryDrawer.deriveSeriesOptionsFromGraph` derives
 * when it builds the series picker. Every "Add alert" / "edit alert"
 * button that opens the drawer pre-filled with a graph must emit the
 * same encoding, otherwise the secondary drawer fails to match the
 * passed `prefilledSeriesName` against any option and the threshold
 * field renders blank.
 *
 * The `name` field on a series is a free-form human label (e.g.
 * "p95 latency"), so we have to read the structural fields directly.
 * `graph` is intentionally `unknown` — call sites pass either a full
 * `CustomGraphInput`, the raw JSONB column from the saved row, or
 * `react-hook-form` form values; they all carry `series[].key /
 * .metric / .aggregation` but their outer shapes diverge.
 */
export function deriveSeriesIdentifier(
  graph: unknown,
  index: number,
): string | undefined {
  if (!graph || typeof graph !== "object") return undefined;
  const candidate = (graph as { series?: unknown }).series;
  if (!Array.isArray(candidate)) return undefined;
  const entry = candidate[index];
  if (!entry || typeof entry !== "object") return undefined;
  const s = entry as Record<string, unknown>;
  const keyPart =
    typeof s.key === "string" && s.key.length > 0
      ? s.key
      : typeof s.metric === "string"
        ? s.metric
        : "value";
  const aggregationPart =
    typeof s.aggregation === "string" ? s.aggregation : "count";
  return `${index}/${keyPart}/${aggregationPart}`;
}
