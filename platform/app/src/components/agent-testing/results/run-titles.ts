/**
 * What one run of a run plan is called, in the runs rail and above the results.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { runOrdinal } from "./run-plans";

/** Every run of a plan reads by its number inside the window. */
export function runTitle({
  index,
  totalCount,
  loadedCount,
}: {
  index: number;
  totalCount: number | null;
  loadedCount: number;
}): string {
  return `Run #${runOrdinal({ index, totalCount, loadedCount })}`;
}
