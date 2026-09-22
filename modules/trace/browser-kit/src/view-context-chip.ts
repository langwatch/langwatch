import { Temporal, toDate } from "@langwatch/time";
import { useMemo } from "react";

import { useFilterStore, useViewStore } from "./explorer.store.ts";
import type { TimeRange } from "./query.slice.ts";
import type { GroupingMode, SortConfig } from "./view.slice.ts";

/** Where the rows come from — traces today, the other signals later. */
export type ObservabilitySource = "traces" | "events" | "logs" | "metrics";

/** The whole Explorer view as one chip an agent can be handed. */
export type TraceViewContextChip = {
  id: string;
  kind: "filter";
  label: string;
  /** Self-describing text: the scope in words, with exact timestamps. */
  ref: string;
};

/**
 * The complete Trace Explorer scope the user can see: time range plus search.
 * This is the useful default on the traces page. A bare trace id says "one row";
 * this says what "these traces" means before the user has selected anything.
 */
export function useTraceViewContext(): TraceViewContextChip {
  const queryText = useFilterStore((state) => state.queryText);
  const timeRange = useFilterStore((state) => state.timeRange);
  const activeLensId = useViewStore((state) => state.activeLensId);
  const activeLens = useViewStore((state) =>
    state.allLenses.find((lens) => lens.id === state.activeLensId),
  );
  const hasLocalChanges = useViewStore((state) => state.draftState.has(state.activeLensId));
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
          : void 0,
        grouping,
        sort,
      }),
    [queryText, timeRange, activeLens, activeLensId, hasLocalChanges, grouping, sort],
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
  grouping?: GroupingMode;
  sort?: SortConfig;
}): TraceViewContextChip {
  const query = queryText.trim();
  const rangeLabel = timeRange.label?.trim() || "Custom time range";
  const from = isoAt(timeRange.from);
  const to = isoAt(timeRange.to);
  const sourceLabel = `${source[0]!.toUpperCase()}${source.slice(1)}`;
  const lensLabel = lens?.name.trim();
  const scopeId = timeRange.presetId ?? `${timeRange.from}:${timeRange.to}`;
  const lensDescription = lens
    ? `${lens.isSavedView ? "saved view" : "built-in lens"}: ${lens.name} (id: ${lens.id})${
        lens.hasLocalChanges ? "; local changes: yes" : ""
      }`
    : void 0;

  return {
    id: `view:${source}:${lens?.id ?? "default"}:${scopeId}:${query}`,
    // The established wire kind, so a hot-reloaded client stays compatible with
    // an api process that has not restarted: id/label/ref carry the rest.
    kind: "filter",
    label: `${sourceLabel}${lensLabel ? ` · ${lensLabel}` : ""} · ${rangeLabel}${
      query ? " · searched" : ""
    }`,
    // Plain, self-describing text is easier for both a person and the agent to
    // inspect than an opaque encoded object, and it keeps exact timestamps.
    ref: [
      `data source: ${source}`,
      `time range: ${rangeLabel}`,
      `from: ${from}`,
      `to: ${to}`,
      lensDescription,
      grouping ? `grouping: ${grouping}` : void 0,
      sort ? `sort: ${sort.columnId} ${sort.direction}` : void 0,
      query ? `search and attribute filters: ${query}` : void 0,
    ]
      .filter((part): part is string => !!part)
      .join("; "),
  };
}

function isoAt(epochMs: number): string {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs)).toISOString();
}
