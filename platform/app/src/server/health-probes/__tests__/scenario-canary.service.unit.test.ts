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
import { describe, expect, it, vi } from "vitest";

import { ScenarioRunStatus, Verdict } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioResults } from "~/server/scenarios/schemas/event-schemas";

import {
  classifyCanaryOutcome,
  createSingleFlightScenarioCanary,
  parseCanaryConfig,
  raceAgainstRealDeadline,
  runScenarioCanary,
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

  describe.each([Verdict.FAILURE, Verdict.INCONCLUSIVE])(
    "given a terminal SUCCESS run judged %s",
    (verdict) => {
      /** @scenario "A run the judge marks FAILURE or INCONCLUSIVE is run_failed" */
      it("classifies the outcome as unhealthy with reason run_failed", () => {
        const outcome = classifyCanaryOutcome({
          status: ScenarioRunStatus.SUCCESS,
          results: verdictResults(verdict),
        });

        expect(outcome).toMatchObject({ healthy: false, reason: "run_failed" });
      });
    },
  );
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
      const cancel = vi.fn();
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
      expect(cancel).not.toHaveBeenCalled();
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

      const first = singleFlight(deps);
      const second = await singleFlight(deps);

      expect(second).toEqual({ busy: true });
      expect(queueRunCalls).toBe(1);

      resolveQueueRun({ scenarioRunId: "canary-run-1" });
      const firstOutcome = await first;
      expect(firstOutcome).not.toEqual({ busy: true });
    });
  });
});

describe("given the canary scenario is queued with no model override", () => {
  /** @scenario "The canary run uses the model configured on the canary scenario" */
  it("passes no model override to the queue call, so the run inherits the model configured on the canary scenario record", async () => {
    const clock = fakeClock();
    let queueRunCallArgs: unknown[] = [];
    const deps: ScenarioCanaryDeps = {
      queueRun: async (...args: unknown[]) => {
        queueRunCallArgs = args;
        return { scenarioRunId: "canary-run-1" };
      },
      getScenarioRunData: async () => ({
        status: ScenarioRunStatus.SUCCESS,
        results: verdictResults(Verdict.SUCCESS),
      }),
      ...clock,
    };

    await runScenarioCanary(deps);

    expect(queueRunCallArgs).toEqual([]);
  });
});

describe("raceAgainstRealDeadline", () => {
  /** @scenario "A wedged datastore times out and releases the in-flight lock" */
  it("resolves to the work value when the work settles before the deadline", async () => {
    const result = await raceAgainstRealDeadline(1_000, Promise.resolve("done"));

    expect(result).toEqual({ value: "done" });
  });

  /** @scenario "A wedged datastore times out and releases the in-flight lock" */
  it("resolves to timedOut when the work never settles before the deadline", async () => {
    vi.useFakeTimers();
    try {
      const wedged = new Promise<string>(() => undefined);
      const raced = raceAgainstRealDeadline(1_000, wedged);

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

        const singleFlight = createSingleFlightScenarioCanary(runScenarioCanary);

        const firstCall = singleFlight(deps);
        await vi.advanceTimersByTimeAsync(
          SCENARIO_CANARY_TOTAL_BUDGET_MS + SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
        );
        const firstOutcome = await firstCall;

        expect(firstOutcome).toMatchObject({ healthy: false, reason: "timeout" });

        // Lock released: a following call runs a real attempt (queueRun fires
        // again) rather than being short-circuited to busy.
        const secondCall = singleFlight(deps);
        await vi.advanceTimersByTimeAsync(
          SCENARIO_CANARY_TOTAL_BUDGET_MS + SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
        );
        const secondOutcome = await secondCall;

        expect(secondOutcome).not.toEqual({ busy: true });
        expect(secondOutcome).toMatchObject({ healthy: false, reason: "timeout" });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("parseCanaryConfig", () => {
  const valid = {
    projectId: "canary-project",
    scenarioId: "canary-scenario",
    targetType: "prompt",
    referenceId: "canary-prompt-id",
  };

  describe("given every config value is present and the target type is known", () => {
    /** @scenario "A misconfigured canary reports unhealthy without launching a run" */
    it("returns the validated config with the target type parsed as the real union", () => {
      const result = parseCanaryConfig(valid);

      expect(result).toEqual({
        projectId: "canary-project",
        scenarioId: "canary-scenario",
        target: { type: "prompt", referenceId: "canary-prompt-id" },
      });
    });

    it("defaults an unset target type to prompt", () => {
      const result = parseCanaryConfig({ ...valid, targetType: undefined });

      expect(result).toMatchObject({ target: { type: "prompt" } });
    });
  });

  describe.each([
    ["projectId", { ...valid, projectId: undefined }],
    ["scenarioId", { ...valid, scenarioId: undefined }],
    ["referenceId", { ...valid, referenceId: undefined }],
  ] as const)("given %s is missing", (_name, raw) => {
    /** @scenario "A misconfigured canary reports unhealthy without launching a run" */
    it("returns an invalid result rather than a config", () => {
      const result = parseCanaryConfig(raw);

      expect(result).toHaveProperty("invalid");
    });
  });

  describe("given the target type is not a member of the simulation-target union", () => {
    /** @scenario "A misconfigured canary reports unhealthy without launching a run" */
    it("returns invalid instead of casting an unknown type past validation", () => {
      const result = parseCanaryConfig({ ...valid, targetType: "not-a-target" });

      expect(result).toHaveProperty("invalid");
    });
  });
});
