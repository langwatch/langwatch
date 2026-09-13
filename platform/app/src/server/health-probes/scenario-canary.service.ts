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
 *    second call for the same run plan while one is in flight starts no second
 *    run — a different run plan is unaffected.
 *  - {@link runScenarioHealthCanary} is the production entrypoint the route
 *    crosses: it looks up the run plan named by `?runPlanId=` (id or slug),
 *    scoped to the project the API key resolved to, validates it, builds the
 *    real deps and drives the single-flight guard.
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
import type { SimulationSuite } from "~/generated/prisma/client";
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
import type { SimulationTarget } from "~/server/scenarios/simulation-target";
import { SuiteRepository } from "~/server/suites/suite.repository";
import { parseSuiteTargets } from "~/server/suites/types";

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
 *
 * `hardDeadline` is optional so every existing direct caller (and the unit
 * tests) keeps computing a fresh full-budget deadline from `deps.now()`; the
 * production entrypoint ({@link runScenarioHealthCanary}) passes one it
 * already computed itself, so the run-plan lookup that precedes this call and
 * the run phase share ONE 120s budget rather than each getting their own.
 */
export async function runScenarioCanary(
  deps: ScenarioCanaryDeps,
  hardDeadline?: number,
): Promise<CanaryOutcome> {
  const startedAt = deps.now();
  const deadline = hardDeadline ?? startedAt + SCENARIO_CANARY_TOTAL_BUDGET_MS;

  const first = await runCanaryAttempt({ deps, hardDeadline: deadline });
  if (first.verdict.healthy || deps.now() >= deadline) {
    return {
      ...first.verdict,
      scenarioRunId: first.scenarioRunId,
      durationMs: deps.now() - startedAt,
    };
  }

  const second = await runCanaryAttempt({ deps, hardDeadline: deadline });
  return {
    ...second.verdict,
    scenarioRunId: second.scenarioRunId,
    durationMs: deps.now() - startedAt,
  };
}

/**
 * Wraps an orchestrator so that while one canary run is in flight, a concurrent
 * call for the SAME run plan starts no second run and is told the probe is busy
 * instead. The guard is keyed by run plan id, not global: two monitors probing
 * two different plans must not deadlock each other — only a duplicate poll of
 * the same plan is deduped. In-process only, which is enough for a probe polled
 * every few minutes.
 */
export function createSingleFlightScenarioCanary(
  run: (
    deps: ScenarioCanaryDeps,
    hardDeadline?: number,
  ) => Promise<CanaryOutcome>,
): (options: {
  key: string;
  deps: ScenarioCanaryDeps;
  hardDeadline?: number;
}) => Promise<CanaryResult> {
  const inFlight = new Map<string, Promise<CanaryOutcome>>();

  return ({ key, deps, hardDeadline }) => {
    if (inFlight.has(key)) return Promise.resolve({ busy: true });
    const attempt = run(deps, hardDeadline).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, attempt);
    return attempt;
  };
}

/** The synthetic actor a canary run is recorded against — no real person. */
const CANARY_ACTOR: RunActor = { id: "scenario-canary", label: "api" };

/** The validated server-side config a canary run needs to launch. */
export interface CanaryConfig {
  projectId: string;
  /**
   * The resolved run plan's own `SimulationSuite.id`, whatever the caller
   * named it by (id or slug), so the single-flight guard has one canonical key
   * per plan.
   */
  runPlanId: string;
  scenarioId: string;
  target: SimulationTarget;
}

/**
 * Validates the run plan the canary is pointed at BEFORE any run is launched,
 * so a misconfiguration reports a clear unhealthy reason instead of dying deep
 * inside the launch prefetch. This probe only ever launches and polls ONE
 * scenario run, so a plan is valid only when it names exactly one scenario and
 * exactly one target; a plan carrying more of either is a misconfiguration for
 * this probe and is rejected rather than silently running the first of many.
 *
 * Pure and id-less like the config parser it replaces: the caller logs which
 * run plan id was invalid, this function only says how. The targets are parsed
 * against the real {@link parseSuiteTargets} schema rather than cast past the
 * type system, so an unknown target type is caught here.
 */
export function parseRunPlanConfig(
  suite: {
    id: string;
    projectId: string;
    scenarioIds: string[];
    targets: unknown;
  } | null,
): CanaryConfig | { invalid: string } {
  if (!suite) {
    return { invalid: "run plan not found" };
  }
  if (suite.scenarioIds.length !== 1) {
    return { invalid: "run plan must have exactly one scenario" };
  }
  let targets: SimulationTarget[];
  try {
    targets = parseSuiteTargets(suite.targets);
  } catch {
    // An unparseable target is a distinct misconfiguration from a plan holding
    // the wrong NUMBER of targets: the operator wrote a target the schema does
    // not recognise, not too many/few. A separate reason keeps the two apart in
    // the logs so the fix (fix the target vs. trim the list) is unambiguous.
    return { invalid: "run plan target is not a valid simulation target" };
  }
  if (targets.length !== 1) {
    return { invalid: "run plan must have exactly one target" };
  }
  const target = targets[0]!;
  return {
    projectId: suite.projectId,
    runPlanId: suite.id,
    scenarioId: suite.scenarioIds[0]!,
    target: { type: target.type, referenceId: target.referenceId },
  };
}

/**
 * Resolves `runPlanId` (id or slug) to a non-archived `run_plan` suite in
 * `projectId`, or `null`. Tries the id first: ids are globally unique, so a
 * `run_plan` hit needs no second read; a miss, or a hit of another kind, falls
 * back to the per-project slug.
 */
async function findRunPlan({
  projectId,
  runPlanId,
}: {
  projectId: string;
  runPlanId: string;
}): Promise<SimulationSuite | null> {
  const suites = new SuiteRepository(prisma);
  const byId = await suites.findById({ id: runPlanId, projectId });
  if (byId?.kind === "run_plan") return byId;
  // An id hit of the wrong kind is not the plan: ids and per-project slugs are
  // enforced unique separately, so a `test_suite` id may coincide with a real
  // run plan's slug — fall through to the slug rather than stop here.
  const bySlug = await suites.findBySlug({ slug: runPlanId, projectId });
  return bySlug?.kind === "run_plan" ? bySlug : null;
}

/**
 * Reads and validates the canary config off the named run plan's suite row,
 * scoped to `projectId`.
 *
 * `projectId` is required, not optional: the multitenancy guard
 * ({@link dbMultiTenancyProtection}) rejects any `SimulationSuite` read whose
 * `where` carries no project scope, so an unscoped lookup here throws deep in
 * Prisma and — before this — escaped the route as a raw 500. Scoping the query
 * both satisfies the guard and confines the canary to a plan the named project
 * actually owns: a runPlanId belonging to another project resolves to `null`
 * and is reported `run_failed`, never run in the wrong project.
 *
 * The whole read is wrapped: the guard throw is only one way this can fail (a
 * datastore outage is another), and a probe that answers `run_failed` on any
 * lookup failure is strictly better than one that leaks a 500 outside the
 * documented 200/503/429 contract.
 *
 * The read is also raced against `raceDeadline` (defaulting to
 * {@link raceAgainstRealDeadline}) so a wedged lookup cannot wedge the
 * endpoint forever. `remainingMs` is what is left of the ONE shared total
 * budget after the caller ({@link runScenarioHealthCanary}) computed its
 * `hardDeadline` — the lookup and the run phase that follows it share a single
 * 120s budget, not 120s each, so without this race a hung read never reaches —
 * and never releases — anything. See the module doc.
 *
 * On a throw the caught error is logged here, once, with the error object
 * attached — the caller does not log again for this path (it gets a distinct
 * `{ lookupFailed: true }` result instead of `{ invalid }` precisely so it
 * knows not to).
 */
async function resolveCanaryConfigFromRunPlan({
  projectId,
  runPlanId,
  raceDeadline = raceAgainstRealDeadline,
  remainingMs,
}: {
  projectId: string;
  runPlanId: string;
  raceDeadline?: DeadlineRace;
  remainingMs: number;
}): Promise<
  | CanaryConfig
  | { invalid: string }
  | { timedOut: true }
  | { lookupFailed: true }
> {
  try {
    const raced = await raceDeadline({
      ms: remainingMs,
      // `runPlanId` may be the plan's id or its slug (slugs are unique per
      // project), resolved through the same repository every other suite read
      // goes through: by id first, then by slug. Both lookups are scoped to
      // `projectId` (satisfying the multitenancy guard and confining the canary
      // to a plan the caller's project owns) and skip archived rows. `kind` is
      // checked here because the repository has no kind-aware finder: a 1×1
      // `test_suite` would otherwise launch a real run the operator never meant
      // to schedule.
      work: findRunPlan({ projectId, runPlanId }),
    });
    if ("timedOut" in raced) {
      logger.error(
        { projectId, runPlanId },
        "Scenario canary run plan lookup timed out; reporting unhealthy without launching a run",
      );
      return { timedOut: true };
    }
    return parseRunPlanConfig(raced.value);
  } catch (error) {
    logger.error(
      { error, projectId, runPlanId },
      "Scenario canary run plan lookup failed; reporting unhealthy without launching a run",
    );
    return { lookupFailed: true };
  }
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
 * The process-wide guard, keyed per run plan: a second request for a plan
 * already in flight starts no new run, while a different plan runs freely.
 */
const singleFlightCanary = createSingleFlightScenarioCanary(runScenarioCanary);

/**
 * The route's single entrypoint. Takes the id or slug of the run plan (a
 * `SimulationSuite` with `kind: "run_plan"`) the canary is pointed at and the
 * `projectId` the caller's API key resolved to. The run plan is looked up scoped to that
 * project (both to satisfy the multitenancy guard and to confine the canary to
 * a plan the project owns), and the canary's own scenario and target come from
 * that plan's row — so a runPlanId that does not belong to `projectId`, or a
 * plan that does not resolve to exactly one scenario and one target, reports
 * unhealthy `run_failed` without launching anything. A run plan lookup that
 * does not settle before `raceDeadline` fires reports unhealthy `timeout`
 * instead, also without launching anything — see
 * {@link resolveCanaryConfigFromRunPlan}. `raceDeadline` defaults to
 * {@link raceAgainstRealDeadline} and is exposed only so unit tests can fake
 * a wedged lookup deterministically.
 *
 * `hardDeadline` is computed exactly once here, from `Date.now()`, and shared
 * end to end: the lookup below is raced against what remains of it
 * (`hardDeadline - startedAt`, which on this first read equals the whole
 * budget), and the same `hardDeadline` is then threaded into
 * {@link runScenarioCanary} for the run phase. A lookup that eats 30s of the
 * budget leaves the run phase only 90s, not a fresh 120s — worst-case wall
 * time for the whole request is the one 120s total, never 120s of lookup on
 * top of another 120s of run.
 */
export async function runScenarioHealthCanary({
  projectId,
  runPlanId,
  raceDeadline,
}: {
  projectId: string;
  runPlanId: string;
  raceDeadline?: DeadlineRace;
}): Promise<CanaryResult> {
  logger.info({ projectId, runPlanId }, "Running scenario canary health check");
  if (!runPlanId || !projectId) {
    logger.error(
      { projectId, runPlanId },
      "Scenario canary called with no projectId/runPlanId; reporting unhealthy without launching a run",
    );
    return { healthy: false, reason: "run_failed", durationMs: 0 };
  }
  const startedAt = Date.now();
  const hardDeadline = startedAt + SCENARIO_CANARY_TOTAL_BUDGET_MS;
  const resolved = await resolveCanaryConfigFromRunPlan({
    projectId,
    runPlanId,
    raceDeadline,
    remainingMs: hardDeadline - startedAt,
  });
  if ("timedOut" in resolved) {
    return { healthy: false, reason: "timeout", durationMs: 0 };
  }
  if ("lookupFailed" in resolved) {
    // Already logged, with the error object, inside
    // resolveCanaryConfigFromRunPlan — logging again here would double-log
    // the same failure.
    return { healthy: false, reason: "run_failed", durationMs: 0 };
  }
  if ("invalid" in resolved) {
    logger.error(
      { projectId, runPlanId, reason: resolved.invalid },
      "Scenario canary run plan invalid; reporting unhealthy without launching a run",
    );
    return { healthy: false, reason: "run_failed", durationMs: 0 };
  }
  // Keyed per project AND resolved plan id, never the caller's spelling: two
  // projects may legitimately reuse a slug and must not block each other, and
  // one plan named by its id in one request and its slug in another is still
  // ONE plan — the second request must see busy, not launch a parallel run.
  return singleFlightCanary({
    key: `${projectId}/${resolved.runPlanId}`,
    deps: buildProductionDeps(resolved),
    hardDeadline,
  });
}
