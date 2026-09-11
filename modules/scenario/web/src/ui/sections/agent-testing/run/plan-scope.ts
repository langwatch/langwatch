/**
 * What a stored row covers, and how the run dialog opens on it.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { parseEvaluatorAttachments } from "@langwatch/scenario-contract";
import { parseSuiteScope, parseSuiteTargets } from "@langwatch/suite-contract";
import type { RunScope } from "./run-configuration.ts";
import type { RunDialogSubject } from "./run-dialog-types.ts";

/** A stored suite row, as much of it as the run dialog needs. */
export type StoredPlanRow = {
  id: string;
  name: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
  targets: unknown;
  /** The evaluators the row attaches; a run plan's own extras. */
  evaluators?: unknown;
};

export function scopeOfStoredPlan(plan: StoredPlanRow): RunScope {
  if (plan.kind === "test_suite") {
    return { mode: "test_suites", testSuiteIds: [plan.id] };
  }
  const stored = parseSuiteScope(plan.scope);
  if (stored.mode === "scenarios") {
    return { mode: "scenarios", scenarioIds: [...plan.scenarioIds] };
  }
  return stored;
}

/**
 * The run dialog subject of a stored row, however the Results tab reached it.
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
    // A test suite answers to no run plan name, so a run of it derives one.
    // A test suite's evaluators are inherited by the run, not carried as the
    // plan's own; only a run plan opens on extras.
    ...(plan.kind === "test_suite"
      ? {}
      : {
          planName: plan.name,
          evaluators: parseEvaluatorAttachments(plan.evaluators),
        }),
    initialTarget: first ? { type: first.type, id: first.referenceId } : null,
    persistedTarget: first ?? null,
  };
}
