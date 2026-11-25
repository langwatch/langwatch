/** A code evaluator runs on the project's engine through the workflow module. */

import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  WorkflowExecutionFailedError,
  type StudioClientEvent,
  type WorkflowApi,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EvaluatorCodeExecutionService } from "../evaluator-code-execution.service.ts";

type SyncInput = Parameters<WorkflowApi["executeStudioEventSync"]>[0];

const event: StudioClientEvent = { type: "is_alive", payload: {} };

function buildService(run: WorkflowApi["executeStudioEventSync"]) {
  const calls: SyncInput[] = [];
  const service = EvaluatorCodeExecutionService.create({
    workflows: createApiFixture<WorkflowApi>({
      executeStudioEventSync: (input) => {
        calls.push(input);
        return run(input);
      },
    }),
  });

  return { calls, service };
}

describe("EvaluatorCodeExecutionService", () => {
  describe("when the engine answers with a result", () => {
    it("dispatches as an evaluation and returns the engine's answer", async () => {
      const { calls, service } = buildService(async () => ({
        status: "success",
        result: { passed: true },
      }));

      const answer = await service.execute({
        projectId: "project_1",
        event,
        causalityDepth: 1,
        parentTrace: { traceId: "a".repeat(32), parentSpanId: "b".repeat(16) },
      });

      expect(calls).toEqual([
        {
          projectId: "project_1",
          event,
          origin: "evaluation",
          causalityDepth: 1,
          parentTrace: { traceId: "a".repeat(32), parentSpanId: "b".repeat(16) },
        },
      ]);
      expect(answer).toEqual({ status: "success", result: { passed: true } });
    });
  });

  describe("when the engine refuses the run", () => {
    it("lets the workflow module's handled error through", async () => {
      const { service } = buildService(() => Promise.reject(new WorkflowExecutionFailedError()));

      await expect(
        service.execute({ projectId: "project_1", event, causalityDepth: 0 }),
      ).rejects.toMatchObject({ code: "workflow_execution_failed" });
    });
  });
});
