import { getApp } from "~/server/app-layer/app";
import type { ScenarioEvaluationResult } from "./schemas/event-schemas";

/**
 * Records the evaluator results of a finished scenario run.
 *
 * Dispatches the `lw.simulation_run.record_evaluations` command. The command
 * reads the judge's verdict off the run's finished event, applies the gate
 * (a required evaluator that failed or errored turns the verdict to
 * failure) and appends the `lw.simulation_run.evaluated` event, which the
 * fold writes onto the run and the suite run subscriber recounts from.
 *
 * Idempotent per run and per result set: the same results recorded twice
 * append one event, and a different set replaces the one before.
 *
 * @see specs/scenarios/scenario-run-evaluations.feature
 */
export async function recordScenarioEvaluations({
  tenantId,
  scenarioRunId,
  evaluations,
}: {
  tenantId: string;
  scenarioRunId: string;
  evaluations: ScenarioEvaluationResult[];
}): Promise<void> {
  await getApp().simulations.recordEvaluations({
    tenantId,
    scenarioRunId,
    evaluations,
    occurredAt: Date.now(),
  });
}
