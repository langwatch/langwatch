/**
 * Sorting utility for scenario sets.
 *
 * Pins internal sets to the top of the list and sorts the rest by last run date.
 *
 * @see specs/scenarios/internal-set-namespace.feature
 */
import type { ScenarioSetData } from "~/server/scenarios/scenario-event.types";
import { isOnPlatformSet } from "~/server/scenarios/internal-set-id";

/**
 * Sorts scenario sets with internal sets pinned to the top.
 * Remaining sets are sorted by last run date (most recent first).
 */
export function sortScenarioSets(sets: ScenarioSetData[]): ScenarioSetData[] {
  return [...sets].sort((a, b) => {
    const aIsInternal = isOnPlatformSet(a.scenarioSetId);
    const bIsInternal = isOnPlatformSet(b.scenarioSetId);

    // Internal sets come first
    if (aIsInternal && !bIsInternal) return -1;
    if (!aIsInternal && bIsInternal) return 1;

    // Within the same category, sort by last run date (most recent first)
    return b.lastRunAt - a.lastRunAt;
  });
}
