/**
 * What a stored row covers, as the run dialog holds it.
 *
 * A test suite is only a grouping, so it covers itself: the scenarios filed in
 * it. A run plan carries its own rule instead, and a hand-picked one carries
 * its list inside that rule, because the stored rule names no scenario.
 *
 * Telling the two apart matters because a run replaces the config of the plan
 * its name resolves onto. A run plan opened as though it were a folder would
 * go out covering "the scenarios filed in the folder with this plan's id",
 * which is nothing, and would write that empty rule over the plan's real
 * scope.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { parseSuiteScope } from "~/server/suites/scope";
import type { RunScope } from "./run-configuration";

/** A stored suite row, as much of it as the scope needs. */
export type StoredPlanRow = {
  id: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
};

export function scopeOfStoredPlan(plan: StoredPlanRow): RunScope {
  if (plan.kind === "folder") {
    return { mode: "folders", folderIds: [plan.id] };
  }
  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "cases") {
    return { mode: "cases", caseIds: [...plan.scenarioIds] };
  }
  return stored;
}
