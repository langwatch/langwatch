/**
 * What a stored row covers, and how the run dialog opens on it.
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
import { parseSuiteTargets } from "~/server/suites/types";
import type { RunScope } from "./run-configuration";
import type { RunDialogSubject } from "./run-dialog-types";

/** A stored suite row, as much of it as the run dialog needs. */
export type StoredPlanRow = {
  id: string;
  name: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
  targets: unknown;
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

/**
 * The run dialog subject of a stored row, however the Results tab reached it.
 *
 * One builder for both ways in, so the plan header, the plan row menu and the
 * Run button on an open plan can never disagree about what the dialog is
 * opened on.
 */
export function storedPlanSubject(
  plan: StoredPlanRow,
): Extract<RunDialogSubject, { kind: "suite" }> {
  const first = parseSuiteTargets(plan.targets)[0];
  return {
    kind: "suite",
    suiteId: plan.id,
    name: plan.name,
    scenarioIds: plan.scenarioIds,
    scope: scopeOfStoredPlan(plan),
    // A folder answers to no run plan name, so a run of it derives one.
    ...(plan.kind === "folder" ? {} : { planName: plan.name }),
    initialTarget: first ? { type: first.type, id: first.referenceId } : null,
    persistedTarget: first ?? null,
  };
}
