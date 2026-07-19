import { useMemo } from "react";
import { useFilterStore } from "../../traces-v2/stores/filterStore";
import type { TimeRange } from "../../traces-v2/stores/filterStore";
import { useViewStore } from "../../traces-v2/stores/viewStore";
import type { LangyContextChip } from "../stores/langyStore";

export type ObservabilitySource = "traces" | "events" | "logs" | "metrics";

/**
 * The complete Trace Explorer scope the user can see: time range plus search.
 * This is the useful default on the traces page. A bare trace id says "one row";
 * this says what "these traces" means before the user has selected anything.
 */
export function useLangyTraceViewContext(): LangyContextChip {
  const queryText = useFilterStore((state) => state.queryText);
  const timeRange = useFilterStore((state) => state.timeRange);
  const activeLensId = useViewStore((state) => state.activeLensId);
  const activeLens = useViewStore((state) =>
    state.allLenses.find((lens) => lens.id === state.activeLensId),
  );
  const hasLocalChanges = useViewStore((state) =>
    state.draftState.has(state.activeLensId),
  );
  const grouping = useViewStore((state) => state.grouping);
  const sort = useViewStore((state) => state.sort);

  return useMemo(
    () =>
      traceViewContextChip({
        source: "traces",
        queryText,
        timeRange,
        lens: activeLens
          ? {
              id: activeLensId,
              name: activeLens.name,
              isSavedView: !activeLens.isBuiltIn,
              hasLocalChanges,
            }
          : undefined,
        grouping,
        sort,
      }),
    [
      queryText,
      timeRange,
      activeLens,
      activeLensId,
      hasLocalChanges,
      grouping,
      sort,
    ],
  );
}

export function traceViewContextChip({
  source = "traces",
  queryText,
  timeRange,
  lens,
  grouping,
  sort,
}: {
  source?: ObservabilitySource;
  queryText: string;
  timeRange: TimeRange;
  lens?: {
    id: string;
    name: string;
    isSavedView: boolean;
    hasLocalChanges?: boolean;
  };
  grouping?: string;
  sort?: { columnId: string; direction: "asc" | "desc" };
}): LangyContextChip {
  const query = queryText.trim();
  const rangeLabel = timeRange.label?.trim() || "Custom time range";
  const from = new Date(timeRange.from).toISOString();
  const to = new Date(timeRange.to).toISOString();
  const sourceLabel = `${source[0]!.toUpperCase()}${source.slice(1)}`;
  const lensLabel = lens?.name.trim();
  const scopeId = timeRange.presetId ?? `${timeRange.from}:${timeRange.to}`;
  const lensDescription = lens
    ? `${lens.isSavedView ? "saved view" : "built-in lens"}: ${lens.name} (id: ${lens.id})${
        lens.hasLocalChanges ? "; local changes: yes" : ""
      }`
    : undefined;

  return {
    id: `view:${source}:${lens?.id ?? "default"}:${scopeId}:${query}`,
    // Keep the established wire kind so a hot-reloaded client stays compatible
    // with an API process that has not restarted yet. The id/label/ref make it a
    // complete view scope rather than a bare query.
    kind: "filter",
    label: `${sourceLabel}${lensLabel ? ` · ${lensLabel}` : ""} · ${rangeLabel}${
      query ? " · searched" : ""
    }`,
    // Plain, self-describing text is easier for both a person and the agent to
    // inspect than an opaque encoded object, while retaining exact timestamps.
    ref: [
      `data source: ${source}`,
      `time range: ${rangeLabel}`,
      `from: ${from}`,
      `to: ${to}`,
      lensDescription,
      grouping ? `grouping: ${grouping}` : undefined,
      sort ? `sort: ${sort.columnId} ${sort.direction}` : undefined,
      query ? `search and attribute filters: ${query}` : undefined,
    ]
      .filter((part): part is string => !!part)
      .join("; "),
  };
}
