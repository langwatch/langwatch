/**
 * The scenario canary health probe.
 *
 * Fires a real scenario run in a dedicated canary project through the same
 * launch path `simulationRunnerRouter.run` uses, blocks until the run is both
 * terminal AND judged, and says what broke: healthy, or one of exactly three
 * named reasons — `timeout`, `run_failed`, `judge_failed`.
 *
 * The moving parts are separated so the interesting logic is testable with no
 * network and no real waiting:
 *  - {@link classifyCanaryOutcome} is the pure status+verdict → healthy/reason
 *    mapper.
 *  - {@link runScenarioCanary} is the orchestrator: queue → poll to terminal
 *    (or per-attempt timeout) → classify → retry once on an unhealthy first
 *    outcome, all bounded by a total wall-time budget. It reads its queue/poll
 *    boundary and its clock from injected {@link ScenarioCanaryDeps}.
 *  - {@link createSingleFlightScenarioCanary} wraps the orchestrator so a
 *    second call while one is in flight starts no second run.
 *  - {@link runScenarioHealthCanary} is the production entrypoint the route
 *    crosses: it builds the real deps and drives the single-flight guard.
 *
 * On a timeout the in-flight run is left alone — there is deliberately no
 * cancel command in {@link ScenarioCanaryDeps}. The execution stall watchdog
 * already reaps a stuck run to terminal ERROR, so nothing is orphaned by
 * walking away from it.
 *
 * @see specs/scenarios/scenario-canary-healthcheck.feature
 */

import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { launchScenarioRun } from "~/server/scenarios/launch-scenario-run.service";
import {
  isTerminalStatus,
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioResults } from "~/server/scenarios/schemas/event-schemas";
import type { RunActor } from "~/server/scenarios/run-actor";
import type { SimulationTarget } from "~/server/scenarios/simulation-target";

const logger = createLogger("langwatch:scenario-canary");

/** Total wall-time budget for the probe, inclusive of the one retry. */
export const SCENARIO_CANARY_TOTAL_BUDGET_MS = 120_000;

/** Per-attempt poll budget — two of these plus overhead stay under the total. */
export const SCENARIO_CANARY_ATTEMPT_BUDGET_MS = 55_000;

/** How often a running attempt polls for a terminal status. */
const SCENARIO_CANARY_POLL_INTERVAL_MS = 2_000;

/** The three, and only three, named ways a canary run is unhealthy. */
export type CanaryReason = "timeout" | "run_failed" | "judge_failed";

/** The pure verdict of one run, before the run's own handle is attached. */
export type CanaryVerdict =
  | { healthy: true }
  | { healthy: false; reason: CanaryReason };

/** A settled canary outcome: the verdict plus the run it came from. */
export type CanaryOutcome = CanaryVerdict & {
  scenarioRunId?: string;
  durationMs: number;
};

/** A settled outcome, or the busy signal a concurrent request gets. */
export type CanaryResult = CanaryOutcome | { busy: true };

/** The one snapshot the orchestrator reads off a run while polling. */
export interface ScenarioRunSnapshot {
  status: ScenarioRunStatus;
  results: ScenarioResults | null | undefined;
}

/**
 * The queue/poll boundary and the clock the orchestrator drives, injected so
 * the whole retry/budget/single-flight logic runs against a fake clock in the
 * unit tests with no network and no real waiting.
 *
 * Deliberately carries NO cancel hook: the probe never cancels a run, so there
 * is nothing here to call. See the module doc.
 */
export interface ScenarioCanaryDeps {
  /** Queues one canary run and returns its generated handle. */
  queueRun: () => Promise<{ scenarioRunId: string }>;
  /** Reads the current status and judge results of a queued run. */
  getScenarioRunData: (
    scenarioRunId: string,
  ) => Promise<ScenarioRunSnapshot | null>;
  /** The logical clock, `Date.now` in production. */
  now: () => number;
  /** Waits `ms`, advancing a fake clock in tests instead of blocking. */
  sleep: (ms: number) => Promise<void>;
}

/**
 * Maps a terminal run's status and judge results onto healthy, or one of the
 * two named unhealthy reasons a settled run can carry (`timeout` comes from the
 * orchestrator, never from here).
 *
 * A terminal FAILURE status (`ERROR|FAILED|CANCELLED|STALLED`) is `run_failed`
 * whatever the results say. Otherwise the run reached terminal SUCCESS, so a
 * missing/errored/verdict-less judge result is `judge_failed`, a SUCCESS
 * verdict is healthy, and a FAILURE/INCONCLUSIVE verdict is `run_failed`.
 */
export function classifyCanaryOutcome({
  status,
  results,
}: ScenarioRunSnapshot): CanaryVerdict {
  if (isTerminalStatus(status) && status !== ScenarioRunStatus.SUCCESS) {
    return { healthy: false, reason: "run_failed" };
  }
  if (!results || results.error || !results.verdict) {
    return { healthy: false, reason: "judge_failed" };
  }
  if (results.verdict === Verdict.SUCCESS) {
    return { healthy: true };
  }
  return { healthy: false, reason: "run_failed" };
}

/**
 * One attempt: queue a run, then poll to a terminal status or the per-attempt
 * budget, whichever comes first. A budget exhaustion is a `timeout`; the run is
 * left to terminate on its own.
 */
async function runCanaryAttempt(
  deps: ScenarioCanaryDeps,
): Promise<{ scenarioRunId: string; verdict: CanaryVerdict }> {
  const { scenarioRunId } = await deps.queueRun();
  const deadline = deps.now() + SCENARIO_CANARY_ATTEMPT_BUDGET_MS;

  while (deps.now() < deadline) {
    const snapshot = await deps.getScenarioRunData(scenarioRunId);
    if (snapshot && isTerminalStatus(snapshot.status)) {
      return { scenarioRunId, verdict: classifyCanaryOutcome(snapshot) };
    }
    // Never sleep past the attempt deadline, so the next attempt can start no
    // later than one attempt-budget after this one did.
    const remaining = deadline - deps.now();
    await deps.sleep(Math.min(SCENARIO_CANARY_POLL_INTERVAL_MS, remaining));
  }

  return { scenarioRunId, verdict: { healthy: false, reason: "timeout" } };
}

/**
 * Runs the canary: one attempt, and if that first attempt is unhealthy, exactly
 * one retry — a single LLM run is noisy, so one healthy retry reports healthy.
 * A healthy first outcome is never retried. Both attempts sit inside the total
 * wall-time budget.
 */
export async function runScenarioCanary(
  deps: ScenarioCanaryDeps,
): Promise<CanaryOutcome> {
  const startedAt = deps.now();

  const first = await runCanaryAttempt(deps);
  if (first.verdict.healthy) {
    return {
      ...first.verdict,
      scenarioRunId: first.scenarioRunId,
      durationMs: deps.now() - startedAt,
    };
  }

  const second = await runCanaryAttempt(deps);
  return {
    ...second.verdict,
    scenarioRunId: second.scenarioRunId,
    durationMs: deps.now() - startedAt,
  };
}

/**
 * Wraps an orchestrator so that while one canary run is in flight, a concurrent
 * call starts no second run and is told the probe is busy instead. In-process
 * only — one guard per process, which is enough for a probe polled every few
 * minutes.
 */
export function createSingleFlightScenarioCanary(
  run: (deps: ScenarioCanaryDeps) => Promise<CanaryOutcome>,
): (deps: ScenarioCanaryDeps) => Promise<CanaryResult> {
  let inFlight: Promise<CanaryOutcome> | null = null;

  return (deps) => {
    if (inFlight) return Promise.resolve({ busy: true });
    const attempt = run(deps).finally(() => {
      inFlight = null;
    });
    inFlight = attempt;
    return attempt;
  };
}

/**
 * The model the canary run is pinned to. One default, overridable by a single
 * env var, so the probe exercises the same model every time rather than
 * whatever a project default drifts to.
 */
export function resolveScenarioCanaryModel(config: {
  SCENARIO_CANARY_MODEL?: string;
}): string {
  return config.SCENARIO_CANARY_MODEL || "gpt-5-mini";
}

/** The synthetic actor a canary run is recorded against — no real person. */
const CANARY_ACTOR: RunActor = { id: "scenario-canary", label: "api" };

/**
 * Builds the production queue/poll boundary: launches through the shared
 * launcher into the dedicated canary project, and reads status back through the
 * same simulations read service the Results tab uses.
 */
function buildProductionDeps(): ScenarioCanaryDeps {
  const projectId = env.SCENARIO_CANARY_PROJECT_ID ?? "";
  const scenarioId = env.SCENARIO_CANARY_SCENARIO_ID ?? "";
  const target: SimulationTarget = {
    type: (env.SCENARIO_CANARY_TARGET_TYPE ??
      "prompt") as SimulationTarget["type"],
    referenceId: env.SCENARIO_CANARY_TARGET_ID ?? "",
  };

  return {
    queueRun: async () => {
      const { scenarioRunId } = await launchScenarioRun({
        prisma,
        projectId,
        scenarioId,
        target,
        actor: CANARY_ACTOR,
        note: "scenario canary health check",
      });
      return { scenarioRunId };
    },
    getScenarioRunData: async (scenarioRunId) => {
      const data = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId,
      });
      return data ? { status: data.status, results: data.results } : null;
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * The one guard for the whole process: a second request while a canary is in
 * flight starts no new run.
 */
const singleFlightCanary = createSingleFlightScenarioCanary(runScenarioCanary);

/**
 * The route's single entrypoint. Takes no arguments — the canary project,
 * scenario, target and model are resolved entirely from server-side config, so
 * no value on the caller's request can redirect a canary run into a customer
 * project.
 */
export async function runScenarioHealthCanary(): Promise<CanaryResult> {
  logger.info(
    { model: resolveScenarioCanaryModel(env) },
    "Running scenario canary health check",
  );
  return singleFlightCanary(buildProductionDeps());
}
