/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/guardrails.feature (latency budget, parallel guardrails)
 */
import type { EvaluationCostRecord, RunEvaluatorInput } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluationGuardrailCheckService } from "../evaluation-guardrail-check.service.ts";

const failing: SingleEvaluationResult = {
  status: "processed",
  passed: false,
  details: "PII detected",
  cost: { amount: 0.01, currency: "USD" },
};

function serviceRunning(run: (input: RunEvaluatorInput) => Promise<SingleEvaluationResult>) {
  const recordCost = vi.fn(async (input: EvaluationCostRecord) => ({ id: input.id }));
  const runEvaluation = vi.fn(run);
  const service = EvaluationGuardrailCheckService.create({
    runner: { runEvaluation },
    ledger: { recordCost },
  });

  return { service, recordCost, runEvaluation };
}

const checkInput = {
  projectId: "proj-1",
  evaluatorType: "langevals/basic",
  settings: {},
  data: { input: "hello", output: "" },
  guardrail: { id: "gr-pii", name: "PII", monitorId: "mon-pii" },
};

describe("EvaluationGuardrailCheckService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the evaluator ignores the abort and outlives the deadline", () => {
    /** @scenario "a guardrail check answers by its deadline even when the evaluator ignores the abort" */
    it("answers stopped by the deadline and aborts the run's signal", async () => {
      let seen: AbortSignal | undefined;
      const { service } = serviceRunning((input) => {
        seen = input.signal;
        return new Promise<never>(() => undefined);
      });

      const outcome = service.check({ ...checkInput, deadlineMs: 800 });
      await vi.advanceTimersByTimeAsync(800);

      await expect(outcome).resolves.toEqual({ status: "stopped", by: "deadline" });
      expect(seen?.aborted).toBe(true);
    });
  });

  describe("when the caller has already aborted", () => {
    it("answers cancelled without running the evaluator", async () => {
      const caller = new AbortController();
      caller.abort();
      const { service, runEvaluation } = serviceRunning(async () => failing);

      await expect(service.check({ ...checkInput, signal: caller.signal })).resolves.toEqual({
        status: "stopped",
        by: "cancelled",
      });
      expect(runEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when the evaluator answers", () => {
    /** @scenario "a guardrail's cost is recorded after the verdict and survives the cancellation" */
    it("returns the result and records its cost against the monitor", async () => {
      const { service, recordCost } = serviceRunning(async () => failing);

      await expect(service.check(checkInput)).resolves.toEqual({
        status: "evaluated",
        result: failing,
      });
      await vi.waitFor(() => expect(recordCost).toHaveBeenCalledTimes(1));
      expect(recordCost).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          costType: "GUARDRAIL",
          referenceType: "CHECK",
          referenceId: "mon-pii",
          amount: 0.01,
          extraInfo: { guardrail_id: "gr-pii", decision: "block" },
        }),
      );
    });
  });
});
