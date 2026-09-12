/**
 * @see specs/scenarios/scenario-canary-healthcheck.feature
 *
 * `classifyCanaryOutcome` is the pure status+verdict -> healthy/reason mapper;
 * `runScenarioCanary` is the orchestrator (queue -> poll -> classify -> retry
 * once on unhealthy, bounded by a total wall-time budget);
 * `createSingleFlightScenarioCanary` wraps it so a concurrent call while one
 * is in flight starts no second run. All three are exercised here with an
 * injected fake queue/poll boundary and a fake logical clock — no real
 * waiting, no network, no getApp().
 *
 * This file is expected to fail until
 * src/server/health-probes/scenario-canary.service.ts exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ScenarioRunStatus,
  Verdict,
} from "@langwatch/scenario-contract";
import type { ScenarioResults } from "@langwatch/scenario-contract";

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

vi.mock("~/server/scenarios/launch-scenario-run.service", () => ({
  launchScenarioRun: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: { simulationSuite: { findFirst: vi.fn() } },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(),
}));

import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { launchScenarioRun } from "~/server/scenarios/launch-scenario-run.service";

import {
  buildProductionDeps,
  type CanaryConfig,
  classifyCanaryOutcome,
  createSingleFlightScenarioCanary,
  type DeadlineRace,
  parseRunPlanConfig,
  raceAgainstRealDeadline,
  runScenarioCanary,
  runScenarioHealthCanary,
  SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
  SCENARIO_CANARY_TOTAL_BUDGET_MS,
  type ScenarioCanaryDeps,
  type ScenarioRunSnapshot,
} from "../scenario-canary.service";

/**
 * A fake logical clock: `sleep` advances the clock instead of actually
 * waiting, so a test exercising a 120-second budget runs in milliseconds
 * while the orchestrator's own elapsed-time bookkeeping is exercised for
 * real (it reads `now()`, same as it would read `Date.now()` in production).
 */
function fakeClock(startedAt = 0) {
  let value = startedAt;
  return {
    now: () => value,
    sleep: async (ms: number) => {
      value += ms;
    },
  };
}

function verdictResults(verdict: Verdict): ScenarioResults {
  return { verdict, metCriteria: [], unmetCriteria: [] };
}

describe("classifyCanaryOutcome", () => {
  describe("given a run that reached terminal SUCCESS with a SUCCESS verdict", () => {
    /** @scenario "A run that finishes and is judged a success is healthy" */
    it("classifies the outcome as healthy", () => {
      const outcome = classifyCanaryOutcome({
        status: ScenarioRunStatus.SUCCESS,
        results: verdictResults(Verdict.SUCCESS),
      });

      expect(outcome.healthy).toBe(true);
    });
  });

  describe("given a terminal run with no judge verdict", () => {
    /** @scenario "A run that finishes with no judge verdict is judge_failed" */
    it("classifies the outcome as unhealthy with reason judge_failed when results are absent", () => {
      const outcome = classifyCanaryOutcome({
        status: ScenarioRunStatus.SUCCESS,
        results: null,
      });

      expect(outcome).toMatchObject({ healthy: false, reason: "judge_failed" });
    });

    it("classifies the outcome as unhealthy with reason judge_failed when results carry an error", () => {
      const outcome = classifyCanaryOutcome({
        status: ScenarioRunStatus.SUCCESS,
        results: {
          verdict: Verdict.SUCCESS,
          metCriteria: [],
          unmetCriteria: [],
          error: "judge crashed",
        },
      });

      expect(outcome).toMatchObject({ healthy: false, reason: "judge_failed" });
    });
  });

  describe.each([
    ScenarioRunStatus.ERROR,
    ScenarioRunStatus.FAILED,
    ScenarioRunStatus.CANCELLED,
    ScenarioRunStatus.STALLED,
  ])("given a run that terminated as %s", (status) => {
    /** @scenario "A run that terminates in a failure status is run_failed" */
    it("classifies the outcome as unhealthy with reason run_failed", () => {
      const outcome = classifyCanaryOutcome({ status, results: null });

      expect(outcome).toMatchObject({ healthy: false, reason: "run_failed" });
    });
  });

  describe.each([
    Verdict.FAILURE,
    Verdict.INCONCLUSIVE,
  ])("given a terminal SUCCESS run judged %s", (verdict) => {
    /** @scenario "A run the judge marks FAILURE or INCONCLUSIVE is run_failed" */
    it("classifies the outcome as unhealthy with reason run_failed", () => {
      const outcome = classifyCanaryOutcome({
        status: ScenarioRunStatus.SUCCESS,
        results: verdictResults(verdict),
      });

      expect(outcome).toMatchObject({ healthy: false, reason: "run_failed" });
    });
  });
});

describe("runScenarioCanary", () => {
  describe("given an upstream that never reports a terminal status", () => {
    /** @scenario "A run that never reaches terminal within budget times out without being cancelled" */
    it("returns within the total budget with reason timeout", async () => {
      const clock = fakeClock();
      let queueRunCalls = 0;
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          queueRunCalls++;
          return { scenarioRunId: `canary-run-${queueRunCalls}` };
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps);

      expect(outcome).toMatchObject({ healthy: false, reason: "timeout" });
      expect(clock.now()).toBeLessThanOrEqual(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });

    /** @scenario "A run that never reaches terminal within budget times out without being cancelled" */
    it("issues no cancel command for the run", async () => {
      const clock = fakeClock();
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => ({ scenarioRunId: "canary-run-1" }),
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      await runScenarioCanary(deps);

      // The deps contract carries no cancel hook at all — there is nothing
      // for the orchestrator to call, which is the point: no cancel command
      // exists for this probe to issue.
      expect("cancelRun" in deps).toBe(false);
    });

    /** @scenario "A run that never reaches terminal within budget times out without being cancelled" */
    it("bounds each attempt to the per-attempt budget", async () => {
      const clock = fakeClock();
      const attemptStarts: number[] = [];
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          attemptStarts.push(clock.now());
          return { scenarioRunId: `canary-run-${attemptStarts.length}` };
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      await runScenarioCanary(deps);

      // Two attempts (initial + one retry), each capped at the per-attempt
      // budget: the second attempt starts no later than one attempt-budget
      // after the first.
      expect(attemptStarts).toHaveLength(2);
      expect(attemptStarts[1]! - attemptStarts[0]!).toBeLessThanOrEqual(
        SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
      );
    });
  });

  describe("given a queueRun whose launch latency spends the whole total budget", () => {
    /** @scenario "The probe abandons the retry once the total budget is spent" */
    it("skips the retry and stays within the total budget, advancing time inside queueRun", async () => {
      const clock = fakeClock();
      let queueRunCalls = 0;
      const deps: ScenarioCanaryDeps = {
        // Launch latency is real wall time: the fake clock advances INSIDE the
        // queue call, not 0ms across it. One slow launch here eats the whole
        // total budget, so no second attempt may start.
        queueRun: async () => {
          queueRunCalls++;
          await clock.sleep(SCENARIO_CANARY_TOTAL_BUDGET_MS);
          return { scenarioRunId: `canary-run-${queueRunCalls}` };
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps);

      expect(outcome).toMatchObject({ healthy: false, reason: "timeout" });
      // The retry is abandoned because the total budget is already spent — the
      // real bound is the total deadline, not just 2x the per-attempt budget.
      expect(queueRunCalls).toBe(1);
      expect(clock.now()).toBeLessThanOrEqual(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });
  });

  describe("given the launch boundary throws", () => {
    /** @scenario "A launch-time failure is reported as unhealthy run_failed, not a raw error" */
    it("classifies a throwing queueRun as run_failed instead of propagating the throw", async () => {
      const clock = fakeClock();
      let queueRunCalls = 0;
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          queueRunCalls++;
          throw new Error("launch blew up");
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps);

      expect(outcome).toMatchObject({ healthy: false, reason: "run_failed" });
      // Retried once, and the second launch throws too — still a settled
      // outcome, never a raw error escaping the documented contract.
      expect(queueRunCalls).toBe(2);
    });
  });

  describe("given the first attempt is unhealthy and the second is healthy", () => {
    /** @scenario "A first unhealthy outcome is retried once and a healthy retry reports healthy" */
    it("reports healthy after exactly two queued runs", async () => {
      const clock = fakeClock();
      let attempt = 0;
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          attempt++;
          return { scenarioRunId: `canary-run-${attempt}` };
        },
        getScenarioRunData: async () =>
          attempt === 1
            ? { status: ScenarioRunStatus.ERROR, results: null }
            : {
                status: ScenarioRunStatus.SUCCESS,
                results: verdictResults(Verdict.SUCCESS),
              },
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps);

      expect(outcome.healthy).toBe(true);
      expect(attempt).toBe(2);
    });
  });

  describe("given the first attempt is healthy", () => {
    /** @scenario "A healthy first outcome is never retried" */
    it("reports healthy after exactly one queued run", async () => {
      const clock = fakeClock();
      let queueRunCalls = 0;
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          queueRunCalls++;
          return { scenarioRunId: `canary-run-${queueRunCalls}` };
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.SUCCESS,
          results: verdictResults(Verdict.SUCCESS),
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps);

      expect(outcome.healthy).toBe(true);
      expect(queueRunCalls).toBe(1);
    });
  });

  describe("given an explicit hardDeadline leaving less than the full budget", () => {
    /** @scenario "The run phase shares the total budget with a preceding lookup instead of getting its own" */
    it("times out at the passed deadline, not a fresh full budget", async () => {
      const clock = fakeClock();
      // Simulates a caller (runScenarioHealthCanary) that already spent 30s of
      // the 120s total budget on a run-plan lookup before calling here: only
      // 90s remain for this run phase, so it must time out at 90s, not run a
      // fresh 120s of its own.
      const remainingBudget = SCENARIO_CANARY_TOTAL_BUDGET_MS - 30_000;
      const hardDeadline = clock.now() + remainingBudget;
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => ({ scenarioRunId: "canary-run-1" }),
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.IN_PROGRESS,
          results: null,
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const outcome = await runScenarioCanary(deps, hardDeadline);

      expect(outcome).toMatchObject({ healthy: false, reason: "timeout" });
      expect(clock.now()).toBeLessThanOrEqual(remainingBudget);
      expect(clock.now()).toBeLessThan(SCENARIO_CANARY_TOTAL_BUDGET_MS);
    });
  });

  describe("given a canary scenario configured with its own model", () => {
    describe("when queueRun is invoked", () => {
      /** @scenario "The canary run uses the model configured on the canary scenario" */
      it("does not pass a model override to launchScenarioRun", async () => {
        vi.mocked(launchScenarioRun).mockResolvedValue({
          scenarioRunId: "canary-run-1",
        } as Awaited<ReturnType<typeof launchScenarioRun>>);
        const config: CanaryConfig = {
          projectId: "canary-project",
          runPlanId: "canary-plan",
          scenarioId: "canary-scenario",
          target: { type: "prompt", referenceId: "canary-prompt" },
        };

        await buildProductionDeps(config).queueRun();

        expect(launchScenarioRun).toHaveBeenCalledTimes(1);
        const [callArgs] = vi.mocked(launchScenarioRun).mock.calls[0]!;
        expect(callArgs).not.toHaveProperty("model");
      });
    });
  });
});

describe("createSingleFlightScenarioCanary", () => {
  describe("given a canary run already in flight", () => {
    /** @scenario "A concurrent canary while one is in flight starts no second run" */
    it("tells a concurrent second request the probe is busy, starting no second run", async () => {
      let resolveQueueRun!: (value: { scenarioRunId: string }) => void;
      let queueRunCalls = 0;
      const inFlight = new Promise<{ scenarioRunId: string }>((resolve) => {
        resolveQueueRun = resolve;
      });
      const clock = fakeClock();
      const deps: ScenarioCanaryDeps = {
        queueRun: async () => {
          queueRunCalls++;
          return inFlight;
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.SUCCESS,
          results: verdictResults(Verdict.SUCCESS),
        }),
        now: clock.now,
        sleep: clock.sleep,
      };

      const singleFlight = createSingleFlightScenarioCanary(runScenarioCanary);

      const first = singleFlight({ key: "plan-a", deps });
      const second = await singleFlight({ key: "plan-a", deps });

      expect(second).toEqual({ busy: true });
      expect(queueRunCalls).toBe(1);

      resolveQueueRun({ scenarioRunId: "canary-run-1" });
      const firstOutcome = await first;
      expect(firstOutcome).not.toEqual({ busy: true });
    });
  });

  describe("given two different run plans are probed concurrently", () => {
    /** @scenario "Two concurrent canaries for different run plans both start a run" */
    it("runs both, telling neither it is busy, because the guard is keyed per run plan", async () => {
      let queueRunCalls = 0;
      const clock = fakeClock();
      const makeDeps = (): ScenarioCanaryDeps => ({
        queueRun: async () => {
          queueRunCalls++;
          return { scenarioRunId: `canary-run-${queueRunCalls}` };
        },
        getScenarioRunData: async () => ({
          status: ScenarioRunStatus.SUCCESS,
          results: verdictResults(Verdict.SUCCESS),
        }),
        now: clock.now,
        sleep: clock.sleep,
      });

      const singleFlight = createSingleFlightScenarioCanary(runScenarioCanary);

      const [resultA, resultB] = await Promise.all([
        singleFlight({ key: "plan-a", deps: makeDeps() }),
        singleFlight({ key: "plan-b", deps: makeDeps() }),
      ]);

      expect(queueRunCalls).toBe(2);
      expect(resultA).not.toEqual({ busy: true });
      expect(resultB).not.toEqual({ busy: true });
    });
  });
});

describe("raceAgainstRealDeadline", () => {
  /** @scenario "A wedged datastore times out and releases the in-flight lock" */
  it("resolves to the work value when the work settles before the deadline", async () => {
    const result = await raceAgainstRealDeadline({
      ms: 1_000,
      work: Promise.resolve("done"),
    });

    expect(result).toEqual({ value: "done" });
  });

  /** @scenario "A wedged datastore times out and releases the in-flight lock" */
  it("resolves to timedOut when the work never settles before the deadline", async () => {
    vi.useFakeTimers();
    try {
      const wedged = new Promise<string>(() => undefined);
      const raced = raceAgainstRealDeadline({ ms: 1_000, work: wedged });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(await raced).toEqual({ timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runScenarioCanary with a wedged boundary await", () => {
  describe("given getScenarioRunData never resolves", () => {
    /** @scenario "A wedged datastore times out and releases the in-flight lock" */
    it("still settles to timeout and releases the single-flight lock for the next call", async () => {
      // A hung boundary await never yields control back to the poll loop, so
      // only a real (here, vitest-faked) timer can bound it. This proves the
      // probe answers `timeout` rather than hanging forever, and that the
      // in-flight lock clears so a following call is NOT told the probe is busy.
      vi.useFakeTimers();
      try {
        let queueRunCalls = 0;
        const deps: ScenarioCanaryDeps = {
          queueRun: async () => {
            queueRunCalls++;
            return { scenarioRunId: `canary-run-${queueRunCalls}` };
          },
          // Never resolves: a wedged datastore read.
          getScenarioRunData: () =>
            new Promise<ScenarioRunSnapshot | null>(() => undefined),
          now: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          // No injected raceDeadline: exercise the real-timer default.
        };

        const singleFlight =
          createSingleFlightScenarioCanary(runScenarioCanary);

        const firstCall = singleFlight({ key: "wedged-plan", deps });
        await vi.advanceTimersByTimeAsync(
          SCENARIO_CANARY_TOTAL_BUDGET_MS + SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
        );
        const firstOutcome = await firstCall;

        expect(firstOutcome).toMatchObject({
          healthy: false,
          reason: "timeout",
        });

        // Lock released: a following call runs a real attempt (queueRun fires
        // again) rather than being short-circuited to busy.
        const secondCall = singleFlight({ key: "wedged-plan", deps });
        await vi.advanceTimersByTimeAsync(
          SCENARIO_CANARY_TOTAL_BUDGET_MS + SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
        );
        const secondOutcome = await secondCall;

        expect(secondOutcome).not.toEqual({ busy: true });
        expect(secondOutcome).toMatchObject({
          healthy: false,
          reason: "timeout",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("parseRunPlanConfig", () => {
  const validSuite = {
    id: "canary-plan",
    projectId: "canary-project",
    scenarioIds: ["canary-scenario"],
    targets: [{ type: "prompt", referenceId: "canary-prompt-id" }],
  };

  describe("given a run plan with exactly one scenario and one target", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("returns the validated config, pulling type/referenceId off the parsed target", () => {
      const result = parseRunPlanConfig(validSuite);

      expect(result).toEqual({
        projectId: "canary-project",
        runPlanId: "canary-plan",
        scenarioId: "canary-scenario",
        target: { type: "prompt", referenceId: "canary-prompt-id" },
      });
    });

    it.each([
      "prompt",
      "http",
      "code",
      "workflow",
      "connected",
    ] as const)("accepts a %s target as a valid single target", (type) => {
      const result = parseRunPlanConfig({
        ...validSuite,
        targets: [{ type, referenceId: "ref" }],
      });

      expect(result).toEqual({
        projectId: "canary-project",
        runPlanId: "canary-plan",
        scenarioId: "canary-scenario",
        target: { type, referenceId: "ref" },
      });
    });
  });

  describe("given the suite is null", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("returns invalid 'run plan not found'", () => {
      expect(parseRunPlanConfig(null)).toEqual({
        invalid: "run plan not found",
      });
    });
  });

  describe.each([
    ["zero", [] as string[]],
    ["two", ["a", "b"]],
  ])("given the run plan names %s scenarios", (_label, scenarioIds) => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("returns invalid rather than a config", () => {
      const result = parseRunPlanConfig({ ...validSuite, scenarioIds });

      expect(result).toEqual({
        invalid: "run plan must have exactly one scenario",
      });
    });
  });

  describe.each([
    ["zero", [] as unknown[]],
    [
      "two",
      [
        { type: "prompt", referenceId: "a" },
        { type: "prompt", referenceId: "b" },
      ],
    ],
  ])("given the run plan names %s targets", (_label, targets) => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("returns invalid rather than a config", () => {
      const result = parseRunPlanConfig({ ...validSuite, targets });

      expect(result).toEqual({
        invalid: "run plan must have exactly one target",
      });
    });
  });

  describe("given the targets JSON cannot be parsed as suite targets", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("returns invalid instead of throwing past validation", () => {
      const result = parseRunPlanConfig({
        ...validSuite,
        targets: [{ type: "not-a-target", referenceId: "x" }],
      });

      expect(result).toEqual({
        invalid: "run plan target is not a valid simulation target",
      });
    });
  });
});

/**
 * A `SimulationSuite` row as the canary's lookup reads it, plus `archivedAt`
 * (filtered in the repository `where`) and `kind` (checked after the read).
 */
type FakeSuiteRow = {
  id: string;
  slug?: string;
  projectId: string;
  scenarioIds: string[];
  targets: unknown;
  kind: string;
  archivedAt: Date | null;
};

/**
 * Drives `prisma.simulationSuite.findFirst` — which `SuiteRepository.findById`
 * and `findBySlug` both sit on — off an in-memory table that HONOURS the
 * `where` (`id` or `slug` + `projectId` + `archivedAt: null`). Returning `null`
 * unconditionally would make an "archived plan is rejected" test pass even if
 * the filter were dropped; making the fake obey the filter is what proves each
 * clause is load-bearing — a row that would match without one clause is
 * filtered out by it, including a plan queried under the wrong projectId.
 * `kind` is deliberately NOT filtered here: the repository finders are
 * kind-agnostic, so the service must reject a non-`run_plan` row itself and
 * the "test_suite is rejected" test proves it does.
 */
function fakeSuiteTable(rows: FakeSuiteRow[]) {
  vi.mocked(prisma.simulationSuite.findFirst).mockImplementation((async (
    args: { where?: Record<string, unknown> } | undefined,
  ) => {
    const where = args?.where ?? {};
    const match = rows.find(
      (row) =>
        (where.id === undefined || row.id === where.id) &&
        (where.slug === undefined || row.slug === where.slug) &&
        (where.projectId === undefined || row.projectId === where.projectId) &&
        (where.archivedAt === undefined || row.archivedAt === where.archivedAt),
    );
    return match ?? null;
  }) as typeof prisma.simulationSuite.findFirst);
}

describe("runScenarioHealthCanary", () => {
  beforeEach(() => {
    vi.mocked(prisma.simulationSuite.findFirst).mockReset();
    vi.mocked(launchScenarioRun).mockReset();
    vi.mocked(getApp).mockReset();
    logger.error.mockClear();
  });

  describe("given a blank runPlanId", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("reports run_failed without reading any run plan", async () => {
      const result = await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "",
      });

      expect(result).toEqual({
        healthy: false,
        reason: "run_failed",
        durationMs: 0,
      });
      expect(prisma.simulationSuite.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("given a runPlanId that resolves to no active run plan", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("looks the plan up by id then by slug, each scoped to the project and unarchived, then reports run_failed", async () => {
      fakeSuiteTable([]);

      const result = await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "missing-plan",
      });

      expect(prisma.simulationSuite.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.simulationSuite.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          id: "missing-plan",
          projectId: "canary-project",
          archivedAt: null,
        },
      });
      expect(prisma.simulationSuite.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          slug: "missing-plan",
          projectId: "canary-project",
          archivedAt: null,
        },
      });
      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("given a runPlanId that belongs to a different project", () => {
    /** @scenario "A run plan belonging to another project reports run_failed without launching a run" */
    it("does not resolve the plan under the wrong projectId, so reports run_failed without launching", async () => {
      fakeSuiteTable([
        {
          id: "cross-project-plan",
          projectId: "owner-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);

      const result = await runScenarioHealthCanary({
        projectId: "some-other-project",
        runPlanId: "cross-project-plan",
      });

      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("given the run plan lookup itself throws", () => {
    /** @scenario "A run plan lookup failure degrades to run_failed, not a raw error" */
    it("reports run_failed without launching, never letting the throw escape", async () => {
      vi.mocked(prisma.simulationSuite.findFirst).mockRejectedValue(
        new Error("database unavailable"),
      );

      const result = await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "any-plan",
      });

      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });

    /** @scenario "A run plan lookup failure degrades to run_failed, not a raw error" */
    it("logs the failure exactly once, not once in the resolver and again at the entrypoint", async () => {
      vi.mocked(prisma.simulationSuite.findFirst).mockRejectedValue(
        new Error("database unavailable"),
      );

      await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "any-plan",
      });

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          projectId: "canary-project",
          runPlanId: "any-plan",
        }),
        expect.any(String),
      );
    });
  });

  describe("given an archived but otherwise-valid 1x1 run_plan", () => {
    /** @scenario "An archived run plan is rejected without launching a run" */
    it("reports run_failed without launching, proving the archivedAt filter", async () => {
      fakeSuiteTable([
        {
          id: "archived-plan",
          projectId: "plan-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: new Date(),
        },
      ]);

      const result = await runScenarioHealthCanary({
        projectId: "plan-project",
        runPlanId: "archived-plan",
      });

      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("given a 1x1 suite whose kind is test_suite, not run_plan", () => {
    /** @scenario "A suite that is not a run plan is rejected without launching a run" */
    it("reports run_failed without launching, proving the kind filter", async () => {
      fakeSuiteTable([
        {
          id: "test-suite",
          projectId: "plan-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "test_suite",
          archivedAt: null,
        },
      ]);

      const result = await runScenarioHealthCanary({
        projectId: "plan-project",
        runPlanId: "test-suite",
      });

      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("given a runPlanId whose plan has more than one scenario", () => {
    /** @scenario "A misconfigured run plan reports unhealthy without launching a run" */
    it("reports run_failed without launching a run", async () => {
      fakeSuiteTable([
        {
          id: "bad-plan",
          projectId: "plan-project",
          scenarioIds: ["a", "b"],
          targets: [{ type: "prompt", referenceId: "r" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);

      const result = await runScenarioHealthCanary({
        projectId: "plan-project",
        runPlanId: "bad-plan",
      });

      expect(result).toMatchObject({ healthy: false, reason: "run_failed" });
      expect(launchScenarioRun).not.toHaveBeenCalled();
    });
  });

  describe("given a runPlanId whose plan has exactly one scenario and target", () => {
    /** @scenario "An authenticated request triggers a real run through the shared queue path" */
    it("launches through the plan's project and reports healthy on a SUCCESS run", async () => {
      fakeSuiteTable([
        {
          id: "good-plan",
          projectId: "plan-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);
      vi.mocked(launchScenarioRun).mockResolvedValue({
        scenarioRunId: "canary-run-1",
      } as Awaited<ReturnType<typeof launchScenarioRun>>);
      vi.mocked(getApp).mockReturnValue({
        simulations: {
          runs: {
            getScenarioRunData: async () => ({
              status: ScenarioRunStatus.SUCCESS,
              results: verdictResults(Verdict.SUCCESS),
            }),
          },
        },
      } as unknown as ReturnType<typeof getApp>);

      const result = await runScenarioHealthCanary({
        projectId: "plan-project",
        runPlanId: "good-plan",
      });

      expect(result).toMatchObject({
        healthy: true,
        scenarioRunId: "canary-run-1",
      });
      const [callArgs] = vi.mocked(launchScenarioRun).mock.calls[0]!;
      expect(callArgs).toMatchObject({
        projectId: "plan-project",
        scenarioId: "plan-scenario",
        target: { type: "prompt", referenceId: "plan-prompt" },
      });
    });
  });

  describe("given a runPlanId that is the plan's slug rather than its id", () => {
    /** @scenario "A run plan may be named by its slug" */
    it("resolves the plan by slug within the caller's project and launches through it", async () => {
      fakeSuiteTable([
        {
          id: "plan-nanoid",
          slug: "canary-health-check",
          projectId: "plan-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);
      vi.mocked(launchScenarioRun).mockResolvedValue({
        scenarioRunId: "canary-run-2",
      } as Awaited<ReturnType<typeof launchScenarioRun>>);
      vi.mocked(getApp).mockReturnValue({
        simulations: {
          runs: {
            getScenarioRunData: async () => ({
              status: ScenarioRunStatus.SUCCESS,
              results: verdictResults(Verdict.SUCCESS),
            }),
          },
        },
      } as unknown as ReturnType<typeof getApp>);

      const result = await runScenarioHealthCanary({
        projectId: "plan-project",
        runPlanId: "canary-health-check",
      });

      expect(result).toMatchObject({
        healthy: true,
        scenarioRunId: "canary-run-2",
      });
      expect(launchScenarioRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a runPlanId that is both a test_suite's id and a run plan's slug", () => {
    /** @scenario "A run plan may be named by its slug" */
    it("falls through the wrong-kind id hit to the slug and launches the run plan", async () => {
      fakeSuiteTable([
        {
          id: "shared-token",
          slug: "some-test-suite",
          projectId: "collide-project",
          scenarioIds: ["suite-scenario"],
          targets: [{ type: "prompt", referenceId: "suite-prompt" }],
          kind: "test_suite",
          archivedAt: null,
        },
        {
          id: "real-plan-id",
          slug: "shared-token",
          projectId: "collide-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);
      vi.mocked(launchScenarioRun).mockResolvedValue({
        scenarioRunId: "canary-run-4",
      } as Awaited<ReturnType<typeof launchScenarioRun>>);
      vi.mocked(getApp).mockReturnValue({
        simulations: {
          runs: {
            getScenarioRunData: async () => ({
              status: ScenarioRunStatus.SUCCESS,
              results: verdictResults(Verdict.SUCCESS),
            }),
          },
        },
      } as unknown as ReturnType<typeof getApp>);

      const result = await runScenarioHealthCanary({
        projectId: "collide-project",
        runPlanId: "shared-token",
      });

      expect(result).toMatchObject({
        healthy: true,
        scenarioRunId: "canary-run-4",
      });
      expect(launchScenarioRun).toHaveBeenCalledTimes(1);
      expect(vi.mocked(launchScenarioRun).mock.calls[0]![0]).toMatchObject({
        scenarioId: "plan-scenario",
      });
    });
  });

  describe("given concurrent requests naming the same plan by id and by slug", () => {
    /** @scenario "A concurrent canary while one is in flight starts no second run" */
    it("keys single flight by the resolved plan id, so the slug request sees busy and launches nothing", async () => {
      fakeSuiteTable([
        {
          id: "flight-plan-id",
          slug: "flight-plan-slug",
          projectId: "flight-project",
          scenarioIds: ["plan-scenario"],
          targets: [{ type: "prompt", referenceId: "plan-prompt" }],
          kind: "run_plan",
          archivedAt: null,
        },
      ]);
      // Hold the first launch open until the second request has been answered,
      // so the first run is provably still in flight when the slug request lands.
      type Launched = Awaited<ReturnType<typeof launchScenarioRun>>;
      let releaseLaunch!: (value: Launched) => void;
      vi.mocked(launchScenarioRun).mockReturnValue(
        new Promise<Launched>((resolve) => {
          releaseLaunch = resolve;
        }),
      );
      vi.mocked(getApp).mockReturnValue({
        simulations: {
          runs: {
            getScenarioRunData: async () => ({
              status: ScenarioRunStatus.SUCCESS,
              results: verdictResults(Verdict.SUCCESS),
            }),
          },
        },
      } as unknown as ReturnType<typeof getApp>);

      const byId = runScenarioHealthCanary({
        projectId: "flight-project",
        runPlanId: "flight-plan-id",
      });
      // Let the id request resolve its plan and take the lock before the slug
      // request resolves the same plan.
      await vi.waitFor(() =>
        expect(launchScenarioRun).toHaveBeenCalledTimes(1),
      );

      const bySlug = await runScenarioHealthCanary({
        projectId: "flight-project",
        runPlanId: "flight-plan-slug",
      });

      expect(bySlug).toEqual({ busy: true });
      expect(launchScenarioRun).toHaveBeenCalledTimes(1);

      releaseLaunch({ scenarioRunId: "canary-run-3" } as Launched);
      expect(await byId).toMatchObject({
        healthy: true,
        scenarioRunId: "canary-run-3",
      });
    });
  });

  describe("given the run plan lookup never settles", () => {
    /** @scenario "A wedged run plan lookup reports unhealthy timeout without launching a run" */
    it("reports timeout via a fired raceDeadline, launches nothing, and leaves a following call not busy", async () => {
      // The lookup itself never resolves, standing in for a wedged datastore
      // read; a fake `raceDeadline` fires immediately instead of relying on
      // vitest's real-timer fake-timer dance, since the interesting behaviour
      // here is what `runScenarioHealthCanary` does with a fired deadline, not
      // whether `raceAgainstRealDeadline` itself fires one (that is covered
      // separately).
      vi.mocked(prisma.simulationSuite.findFirst).mockReturnValue(
        new Promise(() => undefined) as unknown as ReturnType<
          typeof prisma.simulationSuite.findFirst
        >,
      );
      const firedDeadline: DeadlineRace = async ({ ms }) => {
        expect(ms).toBe(SCENARIO_CANARY_TOTAL_BUDGET_MS);
        return { timedOut: true };
      };

      const first = await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "wedged-plan",
        raceDeadline: firedDeadline,
      });

      expect(first).toEqual({
        healthy: false,
        reason: "timeout",
        durationMs: 0,
      });
      expect(launchScenarioRun).not.toHaveBeenCalled();

      // No single-flight lock was ever taken for a lookup that timed out
      // before a run was ever launched, so a following call for the same
      // runPlanId is not told the probe is busy.
      const second = await runScenarioHealthCanary({
        projectId: "canary-project",
        runPlanId: "wedged-plan",
        raceDeadline: firedDeadline,
      });

      expect(second).not.toEqual({ busy: true });
      expect(second).toEqual({
        healthy: false,
        reason: "timeout",
        durationMs: 0,
      });
    });
  });
});
