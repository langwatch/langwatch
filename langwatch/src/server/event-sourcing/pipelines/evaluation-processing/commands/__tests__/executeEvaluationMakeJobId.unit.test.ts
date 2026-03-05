import { describe, expect, it } from "vitest";
import { createExecuteEvaluationCommandClass } from "../executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";

const ExecuteEvaluationCommand = createExecuteEvaluationCommandClass({
  prisma: {} as any,
  spanStorage: {} as any,
  evaluationExecution: {} as any,
});

function makePayload(
  overrides: Partial<ExecuteEvaluationCommandData> = {},
): ExecuteEvaluationCommandData {
  return {
    tenantId: "project-1",
    traceId: "trace-1",
    evaluationId: "eval-1",
    evaluatorId: "mon-1",
    evaluatorType: "custom/basic",
    occurredAt: Date.now(),
    ...overrides,
  };
}

describe("ExecuteEvaluationCommand.makeJobId", () => {
  describe("when no thread debouncing is configured", () => {
    it("returns trace-scoped job ID", () => {
      const jobId = ExecuteEvaluationCommand.makeJobId(makePayload());

      expect(jobId).toBe("exec:project-1:trace-1:mon-1");
    });
  });

  describe("when threadIdleTimeout is set with threadId", () => {
    it("returns thread-scoped job ID for dedup", () => {
      const jobId = ExecuteEvaluationCommand.makeJobId(
        makePayload({
          threadIdleTimeout: 30,
          threadId: "thread-abc",
        }),
      );

      expect(jobId).toBe("exec:project-1:thread:thread-abc:mon-1");
    });
  });

  describe("when threadIdleTimeout is set but threadId is missing", () => {
    it("falls back to trace-scoped job ID", () => {
      const jobId = ExecuteEvaluationCommand.makeJobId(
        makePayload({
          threadIdleTimeout: 30,
        }),
      );

      expect(jobId).toBe("exec:project-1:trace-1:mon-1");
    });
  });

  describe("when threadIdleTimeout is 0", () => {
    it("falls back to trace-scoped job ID", () => {
      const jobId = ExecuteEvaluationCommand.makeJobId(
        makePayload({
          threadIdleTimeout: 0,
          threadId: "thread-abc",
        }),
      );

      expect(jobId).toBe("exec:project-1:trace-1:mon-1");
    });
  });
});
