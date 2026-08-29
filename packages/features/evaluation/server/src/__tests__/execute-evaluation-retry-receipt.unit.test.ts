import { describe, expect, it, vi } from "vitest";
import { EvaluationExecutionIntentService } from "@langwatch/evaluation-server";
import type { EvaluationProcessingEvent } from "@langwatch/evaluation-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  TestEvaluationExecutionReceipt,
} from "../ports/__tests__/support/evaluation-execution.fixtures";

function reportedCostId(events: EvaluationProcessingEvent[]) {
  const event = events.find((candidate) => candidate.type === "lw.evaluation.reported");
  if (!event || event.type !== "lw.evaluation.reported") {
    throw new Error("expected a reported evaluation event");
  }
  return event.data.costId;
}

describe("Evaluation execution receipt", () => {
  it("rethrows a retryable receipt conflict for intent redelivery", async () => {
    const deps = buildExecutionDeps();
    const conflict = new ValidationError("The execution is still in progress.", {
      fault: "customer",
      retryable: true,
    });
    vi.spyOn(deps.executionReceipt, "execute").mockRejectedValue(conflict);

    const intent = EvaluationExecutionIntentService.create(deps);

    await expect(intent.handle(buildExecuteCommand())).rejects.toBe(conflict);
  });

  it("reuses the completed evaluation and cost when the intent is redelivered", async () => {
    const deps = buildExecutionDeps({
      executionResult: {
        status: "processed",
        score: 0.9,
        passed: true,
        cost: { amount: 0.012, currency: "USD" },
      },
    });
    const intent = EvaluationExecutionIntentService.create(deps);
    const command = buildExecuteCommand({ evaluationId: "evaluation-receipt-retry" });

    const first = await intent.handle(command);
    const retry = await intent.handle(command);

    expect(deps.evaluations.executeForTrace).toHaveBeenCalledTimes(1);
    expect(deps.costRecorder.recordCost).toHaveBeenCalledTimes(1);
    expect(deps.executionReceipt.calls).toHaveBeenCalledTimes(2);
    expect(retry[0]?.idempotencyKey).toBe(first[0]?.idempotencyKey);
    expect(retry[0]?.data).toEqual(first[0]?.data);
  });

  it("keeps one durable cost and outcome key after a crash before receipt completion", async () => {
    const deps = buildExecutionDeps({
      executionResult: {
        status: "processed",
        score: 0.9,
        passed: true,
        cost: { amount: 0.012, currency: "USD" },
      },
    });
    const command = buildExecuteCommand({ evaluationId: "evaluation-crash-retry" });
    const first = await EvaluationExecutionIntentService.create(deps).handle(command);

    deps.executionReceipt = new TestEvaluationExecutionReceipt(deps.evaluations, deps.costRecorder);
    const retry = await EvaluationExecutionIntentService.create(deps).handle(command);

    expect(deps.evaluations.executeForTrace).toHaveBeenCalledTimes(2);
    expect(deps.costRecorder.created).toHaveBeenCalledTimes(1);
    expect(retry[0]?.idempotencyKey).toBe(first[0]?.idempotencyKey);
    expect(reportedCostId(retry)).toBe(reportedCostId(first));
  });
});
