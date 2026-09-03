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
  resolveScenarioCanaryModel,
  runScenarioCanary,
  SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
  SCENARIO_CANARY_TOTAL_BUDGET_MS,
  type ScenarioCanaryDeps,
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

describe("resolveScenarioCanaryModel", () => {
  describe("given no model override is configured", () => {
    /** @scenario "The canary run is pinned to one configured model" */
    it("resolves to gpt-5-mini", () => {
      expect(resolveScenarioCanaryModel({})).toBe("gpt-5-mini");
    });
  });

  describe("given a model override is configured", () => {
    it("resolves to the configured override", () => {
      expect(
        resolveScenarioCanaryModel({ SCENARIO_CANARY_MODEL: "openai/gpt-5-mini" }),
      ).toBe("openai/gpt-5-mini");
    });
  });
});
