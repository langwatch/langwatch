import { describe, expect, it, vi } from "vitest";
import { backoffDelayMs, SCENARIO_EVALUATIONS_JOB } from "../constants";
import { TraceDataPendingError } from "../runScenarioEvaluations";
import {
  createScenarioEvaluationsJobHandler,
  isFinalAttempt,
  type ScenarioEvaluationsJobDeps,
  scenarioEvaluationsJobId,
} from "../scenarioEvaluations.job";
import type { ScenarioEvaluationsJobPayload } from "../types";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const payload: ScenarioEvaluationsJobPayload = {
  tenantId: "project-1",
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  suiteId: "suite-1",
  planId: null,
  traceIds: ["trace-1"],
  attempt: 1,
  occurredAt: 1_000,
};

describe("scenario evaluations job", () => {
  describe("when the trace data has not arrived yet", () => {
    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("queues the next attempt after 3 seconds, doubling every attempt", async () => {
      const run = vi.fn(async () => {
        throw new TraceDataPendingError("no run_sql call in the trace");
      });
      const reschedule = vi.fn<ScenarioEvaluationsJobDeps["reschedule"]>(
        async () => {},
      );
      const handler = createScenarioEvaluationsJobHandler({ run, reschedule });

      await handler(payload);
      await handler({ ...payload, attempt: 2 });
      await handler({ ...payload, attempt: 3 });

      expect(run).toHaveBeenCalledWith({ payload, finalAttempt: false });
      expect(reschedule.mock.calls.map(([call]) => call)).toEqual([
        {
          payload: expect.objectContaining({ attempt: 2 }),
          delayMs: 3_000,
        },
        {
          payload: expect.objectContaining({ attempt: 3 }),
          delayMs: 6_000,
        },
        {
          payload: expect.objectContaining({ attempt: 4 }),
          delayMs: 12_000,
        },
      ]);
    });

    it("tells the worker the sixth attempt is the last and never queues again after it", async () => {
      const run = vi.fn(async () => {
        throw new TraceDataPendingError("no run_sql call in the trace");
      });
      const reschedule = vi.fn<ScenarioEvaluationsJobDeps["reschedule"]>(
        async () => {},
      );
      const handler = createScenarioEvaluationsJobHandler({ run, reschedule });
      const last = {
        ...payload,
        attempt: SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS,
      };

      await expect(handler(last)).rejects.toBeInstanceOf(TraceDataPendingError);

      expect(run).toHaveBeenCalledWith({ payload: last, finalAttempt: true });
      expect(reschedule).not.toHaveBeenCalled();
      expect(isFinalAttempt(5)).toBe(false);
      expect(isFinalAttempt(6)).toBe(true);
    });
  });

  describe("when the worker fails for another reason", () => {
    it("lets the error through so the queue retries it", async () => {
      const handler = createScenarioEvaluationsJobHandler({
        run: vi.fn(async () => {
          throw new Error("database down");
        }),
        reschedule: vi.fn(async () => {}),
      });

      await expect(handler(payload)).rejects.toThrow("database down");
    });
  });

  it("names one job per run and attempt", () => {
    expect(scenarioEvaluationsJobId(payload)).toBe(
      "project-1:run-1:scenario-evaluations:1",
    );
    expect(backoffDelayMs(6)).toBe(96_000);
  });
});
