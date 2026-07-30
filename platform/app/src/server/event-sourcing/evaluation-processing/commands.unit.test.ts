import { describe, expect, it } from "vitest";
import { reportEvaluation } from "./report.command";
import { startEvaluation } from "./start.command";

describe("the start command", () => {
  it("emits exactly the started event, carrying the input through unchanged", async () => {
    const input = {
      evaluationId: "eval-1",
      evaluatorId: "monitor-1",
      evaluatorType: "langevals/answer_correctness",
      occurredAt: 1_000,
    };
    expect(await startEvaluation(input)).toEqual([
      { type: "started", data: input },
    ]);
  });
});

describe("the report command", () => {
  it("emits exactly the reported event, carrying the input through unchanged", async () => {
    const input = {
      evaluationId: "eval-1",
      evaluatorId: "monitor-1",
      evaluatorType: "langevals/answer_correctness",
      status: "processed" as const,
      occurredAt: 2_000,
    };
    expect(await reportEvaluation(input)).toEqual([
      { type: "reported", data: input },
    ]);
  });
});
