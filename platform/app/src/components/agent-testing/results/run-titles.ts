/**
 * What one run of a run plan is called, in the runs rail and above the results.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import type { BatchRun } from "@langwatch/suite-web";
import { oneOffRunTitle, type RunPlan, runOrdinal } from "./run-plans";

/** A one-off run carries the name of the case it ran; a plan run its number. */
export function runTitle({
  plan,
  batch,
  index,
  totalCount,
  loadedCount,
}: {
  plan: RunPlan;
  batch: BatchRun;
  index: number;
  totalCount: number | null;
  loadedCount: number;
}): string {
  const ownTitle =
    plan.kind === "one-off" ? oneOffRunTitle(batch.scenarioRuns) : null;
  return ownTitle ?? `Run #${runOrdinal({ index, totalCount, loadedCount })}`;
}
