import type { NumericMode } from "../../stores/numericModeStore";
import type { RangeSectionData } from "./types";

/**
 * Pure resolution of numeric-facet presentation mode. Two small helpers
 * factored out of `useFilterSidebarData` so they can be unit-tested
 * without rendering the sidebar:
 *
 *   • `computeDiscreteEligible` — picks the range descriptors that carry
 *     a small enough bounded distinct set to render as a tick-list.
 *   • `resolveNumericModeByKey` — folds in the per-project user override
 *     (`override ?? "discrete"` — eligible facets default to Discrete).
 *
 * The hook re-implements neither: it calls these and renders the result.
 */

export function computeDiscreteEligible(params: {
  ranges: readonly RangeSectionData[];
  maxDistinctValues: number;
}): Map<string, RangeSectionData> {
  const { ranges, maxDistinctValues } = params;
  const map = new Map<string, RangeSectionData>();
  for (const r of ranges) {
    const d = r.discrete;
    if (d && d.values.length > 0 && d.distinctCount <= maxDistinctValues) {
      map.set(r.key, r);
    }
  }
  return map;
}

export function resolveNumericModeByKey(params: {
  discreteEligible: ReadonlyMap<string, RangeSectionData>;
  numericModes: Readonly<Record<string, NumericMode>>;
}): Map<string, NumericMode> {
  const { discreteEligible, numericModes } = params;
  const map = new Map<string, NumericMode>();
  for (const key of discreteEligible.keys()) {
    // Eligible facets default to discrete; a user override wins.
    map.set(key, numericModes[key] ?? "discrete");
  }
  return map;
}
