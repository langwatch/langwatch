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
 *    (or per-attempt / total-budget deadline) → classify → retry once on an
 *    unhealthy first outcome, all bounded by a real total wall-time budget. It
 *    reads its queue/poll boundary and its clock from injected
 *    {@link ScenarioCanaryDeps}.
 *  - {@link createSingleFlightScenarioCanary} wraps the orchestrator so a
 *    second call while one is in flight starts no second run.
 *  - {@link runScenarioHealthCanary} is the production entrypoint the route
 *    crosses: it validates the server-side config, builds the real deps and
 *    drives the single-flight guard.
 *
 * Two failure modes the injected clock alone cannot bound are handled with a
 * real timer instead: a boundary await (`queueRun` / `getScenarioRunData`) that
 * never returns is raced against a wall-clock deadline so a wedged datastore
 * reports `timeout` rather than hanging the probe forever, and the total budget
 * is a real deadline threaded into every attempt so unbounded launch/DB latency
 * cannot run past it.
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
import type { RunActor } from "~/server/scenarios/run-actor";
import {
  isTerminalStatus,
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import type { ScenarioResults } from "~/server/scenarios/schemas/event-schemas";
import {
  type SimulationTarget,
  simulationTargetSchema,
} from "~/server/scenarios/simulation-target";

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
 * Races `work` against a wall-clock deadline of `ms`, resolving to `timedOut`
 * when the deadline fires before `work` settles. This is the one guard that
 * does NOT run on the injected logical clock: a wedged boundary await never
 * yields control back to the poll loop, so only a real timer can bound it. The
 * production implementation ({@link raceAgainstRealDeadline}) uses `setTimeout`;
 * the unit tests drive it with vitest fake timers.
 */
export type DeadlineRace = <T>(options: {
  ms: number;
  work: Promise<T>;
}) => Promise<{ timedOut: true } | { value: T }>;

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
  /**
   * Bounds a single boundary await against a real deadline. Optional: defaults
   * to {@link raceAgainstRealDeadline}. Injected only by tests that need to
   * drive the wedged-datastore path deterministically.
   */
  raceDeadline?: DeadlineRace;
}

/**
 * Production {@link DeadlineRace}: a real `setTimeout` the injected logical
 * clock cannot influence, so a boundary await that never returns is abandoned
 * after `ms` real milliseconds rather than hanging the probe. When `work` wins
 * the timer is cleared, so a fast boundary adds no real waiting. The abandoned
 * run is left to terminate on its own (no cancel); a late rejection from it is
 * swallowed so it never surfaces as an unhandled rejection.
 */
export const raceAgainstRealDeadline: DeadlineRace = ({ ms, work }) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const settled = work.then((value) => ({ value }));
  // Handle a late rejection of the abandoned work if the deadline won the race,
  // so it never surfaces as an unhandled rejection.
  void settled.catch(() => undefined);
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
};

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
 * One attempt: queue a run, then poll to a terminal status or the attempt's
 * deadline, whichever comes first. The deadline is the earlier of one
 * per-attempt budget and the probe's total `hardDeadline`, so a slow attempt
 * can never push the probe past its total budget.
 *
 * Both boundary awaits are raced against the deadline so a wedged `queueRun` or
 * `getScenarioRunData` reports `timeout` rather than hanging forever. A launch
 * or read that THROWS (a rejected boundary) is a `run_failed`, so a launch-time
 * error is classified inside the documented contract instead of escaping as a
 * raw 500.
 */
async function runCanaryAttempt({
  deps,
  hardDeadline,
}: {
  deps: ScenarioCanaryDeps;
  hardDeadline: number;
}): Promise<{ scenarioRunId?: string; verdict: CanaryVerdict }> {
  const raceDeadline = deps.raceDeadline ?? raceAgainstRealDeadline;
  const deadline = Math.min(
    deps.now() + SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
    hardDeadline,
  );
  let scenarioRunId: string | undefined;

  try {
    const queued = await raceDeadline({
      ms: deadline - deps.now(),
      work: deps.queueRun(),
    });
    if ("timedOut" in queued) {
      return { verdict: { healthy: false, reason: "timeout" } };
    }
    scenarioRunId = queued.value.scenarioRunId;

    while (deps.now() < deadline) {
      const read = await raceDeadline({
        ms: deadline - deps.now(),
        work: deps.getScenarioRunData(scenarioRunId),
      });
      if ("timedOut" in read) break;
      const snapshot = read.value;
      if (snapshot && isTerminalStatus(snapshot.status)) {
        return { scenarioRunId, verdict: classifyCanaryOutcome(snapshot) };
      }
      // Never sleep past the deadline, so the next attempt can start no later
      // than one attempt-budget after this one did.
      const remaining = deadline - deps.now();
      await deps.sleep(Math.min(SCENARIO_CANARY_POLL_INTERVAL_MS, remaining));
    }

    return { scenarioRunId, verdict: { healthy: false, reason: "timeout" } };
  } catch (error) {
    logger.error(
      { error, scenarioRunId },
      "Scenario canary attempt failed to launch or read the run",
    );
    return { scenarioRunId, verdict: { healthy: false, reason: "run_failed" } };
  }
}

/**
 * Runs the canary: one attempt, and if that first attempt is unhealthy, exactly
 * one retry — a single LLM run is noisy, so one healthy retry reports healthy.
 * A healthy first outcome is never retried, and neither is a first failure once
 * the total wall-time budget is already spent: a retry that could not finish
 * inside the budget is worse than reporting the first failure now.
 */
export async function runScenarioCanary(
  deps: ScenarioCanaryDeps,
): Promise<CanaryOutcome> {
  const startedAt = deps.now();
  const hardDeadline = startedAt + SCENARIO_CANARY_TOTAL_BUDGET_MS;

  const first = await runCanaryAttempt({ deps, hardDeadline });
  if (first.verdict.healthy || deps.now() >= hardDeadline) {
    return {
      ...first.verdict,
      scenarioRunId: first.scenarioRunId,
      durationMs: deps.now() - startedAt,
    };
  }

  const second = await runCanaryAttempt({ deps, hardDeadline });
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

/** The synthetic actor a canary run is recorded against — no real person. */
const CANARY_ACTOR: RunActor = { id: "scenario-canary", label: "api" };

/** The validated server-side config a canary run needs to launch. */
export interface CanaryConfig {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
}

/**
 * Validates the four server-side config values the canary needs BEFORE any run
 * is launched, so a misconfiguration reports a clear unhealthy reason instead
 * of dying deep inside the launch prefetch. The target type is parsed against
 * the real {@link simulationTargetSchema} union rather than cast past the type
 * system, so an unknown type is caught here.
 */
export function parseCanaryConfig(raw: {
  projectId: string | undefined;
  scenarioId: string | undefined;
  targetType: string | undefined;
  referenceId: string | undefined;
}): CanaryConfig | { invalid: string } {
  const { projectId, scenarioId, referenceId } = raw;
  const parsedType = simulationTargetSchema.shape.type.safeParse(
    raw.targetType ?? "prompt",
  );
  const missing = [
    !projectId && "SCENARIO_CANARY_PROJECT_ID",
    !scenarioId && "SCENARIO_CANARY_SCENARIO_ID",
    !referenceId && "SCENARIO_CANARY_TARGET_ID",
    !parsedType.success && "SCENARIO_CANARY_TARGET_TYPE",
  ].filter((entry): entry is string => Boolean(entry));

  if (!projectId || !scenarioId || !referenceId || !parsedType.success) {
    return { invalid: `scenario canary misconfigured: ${missing.join(", ")}` };
  }

  return {
    projectId,
    scenarioId,
    target: { type: parsedType.data, referenceId },
  };
}

/** Reads and validates the canary config off server-side env. */
function resolveCanaryConfig(): CanaryConfig | { invalid: string } {
  return parseCanaryConfig({
    projectId: env.SCENARIO_CANARY_PROJECT_ID,
    scenarioId: env.SCENARIO_CANARY_SCENARIO_ID,
    targetType: env.SCENARIO_CANARY_TARGET_TYPE,
    referenceId: env.SCENARIO_CANARY_TARGET_ID,
  });
}

/**
 * Builds the production queue/poll boundary from validated config: launches
 * through the shared launcher into the dedicated canary project, and reads
 * status back through the same simulations read service the Results tab uses.
 */
export function buildProductionDeps(config: CanaryConfig): ScenarioCanaryDeps {
  const { projectId, scenarioId, target } = config;

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
 * project. A misconfiguration reports unhealthy `run_failed` without launching
 * anything.
 */
export async function runScenarioHealthCanary(): Promise<CanaryResult> {
  logger.info("Running scenario canary health check");
  const config = resolveCanaryConfig();
  if ("invalid" in config) {
    logger.error(
      { reason: config.invalid },
      "Scenario canary misconfigured; reporting unhealthy without launching a run",
    );
    return { healthy: false, reason: "run_failed", durationMs: 0 };
  }
  return singleFlightCanary(buildProductionDeps(config));
}
