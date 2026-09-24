/**
 * The scenario canary's decisions, ported from main's `health-probes/scenario-canary.service.ts`:
 * what a settled run means, which run plans it may launch, and what the probe answers.
 */
import {
  isTerminalStatus,
  ScenarioRunStatus,
  type SimulationRunData,
  Verdict,
} from "@langwatch/scenario-contract";
import type { Suite } from "@langwatch/suite-contract";

/** Total wall-time budget for the probe, inclusive of the one retry. */
export const SCENARIO_CANARY_TOTAL_BUDGET_MS = 120_000;

/** Per-attempt poll budget - two of these plus overhead stay under the total. */
export const SCENARIO_CANARY_ATTEMPT_BUDGET_MS = 55_000;

/** How often a running attempt polls for a terminal status. */
export const SCENARIO_CANARY_POLL_INTERVAL_MS = 2_000;

/** Neither an id nor a slug is ever this long; a longer one is refused before any read. */
export const MAX_CANARY_QUERY_PARAM_LENGTH = 128;

export type CanaryReason = "timeout" | "run_failed" | "judge_failed";

export type CanaryVerdict = { healthy: true } | { healthy: false; reason: CanaryReason };

export type CanaryOutcome = CanaryVerdict & { scenarioRunId?: string; durationMs: number };

export type CanaryResult = CanaryOutcome | { busy: true };

export type ScenarioRunSnapshot = Pick<SimulationRunData, "status" | "results">;

/** The one scenario and target a valid run plan names, keyed by the plan's own id. */
export type CanaryConfig = Readonly<{
  projectId: string;
  runPlanId: string;
  scenarioId: string;
  target: Suite["targets"][number];
}>;

/** A terminal failure status is `run_failed`; a success is judged by its verdict. */
export function classifyCanaryOutcome({ status, results }: ScenarioRunSnapshot): CanaryVerdict {
  if (isTerminalStatus(status) && status !== ScenarioRunStatus.SUCCESS) {
    return { healthy: false, reason: "run_failed" };
  }
  if (!results || results.error || !results.verdict) {
    return { healthy: false, reason: "judge_failed" };
  }
  if (results.verdict === Verdict.SUCCESS) return { healthy: true };

  return { healthy: false, reason: "run_failed" };
}

/** A live run plan naming exactly one scenario and one target, or how it is not. */
export function parseRunPlanConfig(suite: Suite | undefined): CanaryConfig | { invalid: string } {
  if (!suite) return { invalid: "run plan not found" };
  if (suite.scenarioIds.length !== 1) {
    return { invalid: "run plan must have exactly one scenario" };
  }
  const [scenarioId] = suite.scenarioIds;
  const [target] = suite.targets;
  if (suite.targets.length !== 1 || !target || !scenarioId) {
    return { invalid: "run plan must have exactly one target" };
  }

  return { projectId: suite.projectId, runPlanId: suite.id, scenarioId, target };
}

/** Whether a suite is a run plan the canary may launch: a live one, named by id or slug. */
export function isNamedLivePlan({
  suite,
  runPlanId,
  by,
}: {
  suite: Suite;
  runPlanId: string;
  by: "id" | "slug";
}): boolean {
  return suite[by] === runPlanId && suite.kind === "run_plan" && suite.archivedAt === null;
}

/** Main's answer for one settled canary: 429 busy, 200 ok, or 503 with the named reason. */
export function canaryAnswer(result: CanaryResult): { status: number; body: unknown } {
  if ("busy" in result) return { status: 429, body: { status: "busy" } };
  const { scenarioRunId, durationMs } = result;
  if (result.healthy) return { status: 200, body: { status: "ok", scenarioRunId, durationMs } };

  return {
    status: 503,
    body: { status: "unhealthy", reason: result.reason, scenarioRunId, durationMs },
  };
}
