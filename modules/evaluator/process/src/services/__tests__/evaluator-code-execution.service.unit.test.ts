/** A code evaluator runs on the project's engine through the workflow module. */

import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { StudioClientEvent, WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { EvaluatorCodeExecutionService } from "../evaluator-code-execution.service.ts";

type SyncInput = Parameters<WorkflowApi["executeStudioEventSync"]>[0];

const event: StudioClientEvent = { type: "is_alive", payload: {} };

function buildService(answer: Awaited<ReturnType<WorkflowApi["executeStudioEventSync"]>>) {
  const calls: SyncInput[] = [];
  const service = EvaluatorCodeExecutionService.create({
    workflows: createApiFixture<WorkflowApi>({
      executeStudioEventSync: async (input) => {
        calls.push(input);
        return answer;
      },
    }),
  });

  return { calls, service };
}

describe("EvaluatorCodeExecutionService", () => {
  describe("when the engine answers with a result", () => {
    it("dispatches as an evaluation and returns the parsed result", async () => {
      const { calls, service } = buildService({
        ok: true,
        status: 200,
        statusText: "OK",
        body: { status: "success", result: { passed: true }, trace_id: "t" },
      });

      const result = await service.execute({
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
      expect(result).toEqual({
        ok: true,
        statusText: "OK",
        body: { status: "success", result: { passed: true } },
      });
    });
  });

  describe("when the engine refuses with a non-JSON body", () => {
    it("reports the status text instead of failing to parse", async () => {
      const { service } = buildService({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        body: "<html>bad gateway</html>",
      });

      const result = await service.execute({ projectId: "project_1", event, causalityDepth: 0 });

      expect(result).toEqual({
        ok: false,
        statusText: "Bad Gateway",
        body: { status: "error", error: { message: "Bad Gateway" } },
      });
    });
  });

  describe("when the engine refuses with a structured error", () => {
    it("keeps the engine's message and traceback", async () => {
      const { service } = buildService({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        body: { status: "error", error: { message: "NameError: x", traceback: "line 3" } },
      });

      const result = await service.execute({ projectId: "project_1", event, causalityDepth: 0 });

      expect(result).toEqual({
        ok: false,
        statusText: "Internal Server Error",
        body: { status: "error", error: { message: "NameError: x", traceback: "line 3" } },
      });
    });
  });
});
