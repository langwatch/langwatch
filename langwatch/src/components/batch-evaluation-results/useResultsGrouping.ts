/**
 * useResultsGrouping — shared discovery for "group by" surfaces in the
 * batch-evaluation-results view.
 *
 * Two callers, two sources:
 *  - ComparisonTable rows  → dataset-entry metadata (row.datasetEntry)
 *  - ComparisonCharts bars → target-column metadata (targetCol.metadata)
 *
 * The hook returns just the discovered keys. Selection state and URL
 * sync are owned by the callsite (see BatchEvaluationResults for the
 * dataset-entry/URL pairing).
 */

import { useMemo } from "react";

import type { ComparisonRunData } from "./types";

export type GroupingSource = "dataset-entry" | "target-metadata";

export interface UseResultsGroupingArgs {
  source: GroupingSource;
  comparisonData: ComparisonRunData[] | null | undefined;
}

export interface UseResultsGroupingResult {
  /** Metadata keys safe to expose as grouping options. */
  availableKeys: string[];
}

/** Keys that the chart treats specially via dedicated "Model" / "Prompt"
 * options — excluded from the generic metadata-key list. */
const TARGET_METADATA_RESERVED = new Set([
  "model",
  "prompt_id",
  "prompt",
  "version",
]);

export function useResultsGrouping({
  source,
  comparisonData,
}: UseResultsGroupingArgs): UseResultsGroupingResult {
  const availableKeys = useMemo(() => {
    if (!comparisonData || comparisonData.length === 0) return [];
    return source === "dataset-entry"
      ? discoverDatasetEntryKeys(comparisonData)
      : discoverTargetMetadataKeys(comparisonData);
  }, [source, comparisonData]);

  return { availableKeys };
}

/**
 * Pick metadata keys from `row.datasetEntry` that make useful grouping
 * dimensions. A key qualifies when it has 2+ distinct values but is not
 * unique-per-row (which would just shred the table into N singletons).
 */
function discoverDatasetEntryKeys(data: ComparisonRunData[]): string[] {
  const distinctValuesPerKey = new Map<string, Set<string>>();
  let maxRowsInAnyRun = 0;

  for (const run of data) {
    if (!run.data) continue;
    maxRowsInAnyRun = Math.max(maxRowsInAnyRun, run.data.rows.length);
    for (const row of run.data.rows) {
      for (const [key, value] of Object.entries(row.datasetEntry)) {
        if (value === null || value === undefined) continue;
        if (typeof value === "object") continue; // arrays/objects are not group-able
        const seen = distinctValuesPerKey.get(key) ?? new Set<string>();
        seen.add(String(value));
        distinctValuesPerKey.set(key, seen);
      }
    }
  }

  const isGroupable = (distinct: number) =>
    distinct >= 2 && distinct < maxRowsInAnyRun;

  return Array.from(distinctValuesPerKey.entries())
    .filter(([, values]) => isGroupable(values.size))
    .map(([key]) => key)
    .sort();
}

/**
 * Pick metadata keys from `targetColumn.metadata` that should appear as
 * generic Group-by options in the chart. Reserved keys ("model",
 * "prompt_id", "prompt", "version") are surfaced via their own
 * dedicated options upstream and are excluded here.
 */
function discoverTargetMetadataKeys(data: ComparisonRunData[]): string[] {
  const keys = new Set<string>();
  for (const run of data) {
    if (!run.data) continue;
    for (const targetCol of run.data.targetColumns) {
      if (!targetCol.metadata) continue;
      for (const key of Object.keys(targetCol.metadata)) {
        if (TARGET_METADATA_RESERVED.has(key)) continue;
        keys.add(key);
      }
    }
  }
  return Array.from(keys).sort();
}
