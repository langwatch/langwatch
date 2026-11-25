/** A peer's synchronous Studio event reaches the project's engine; a refusal is a handled error. */

import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type {
  WorkflowNlpDispatchInput,
  WorkflowNlpDispatchResponse,
  WorkflowNlpRuntime,
} from "../../app/workflow.app.ts";
import { WorkflowStudioSyncService } from "../workflow-studio-sync.service.ts";

const event: StudioClientEvent = { type: "is_alive", payload: {} };

function buildService(answer: { ok: boolean; status: number; statusText: string; body: unknown }) {
  const calls: WorkflowNlpDispatchInput[] = [];
  const runtime: WorkflowNlpRuntime = {
    dispatch: async (input): Promise<WorkflowNlpDispatchResponse> => {
      calls.push(input);
      return {
        ok: answer.ok,
        status: answer.status,
        statusText: answer.statusText,
        json: async () => answer.body,
        text: async () => JSON.stringify(answer.body),
      };
    },
  };

  return { calls, service: WorkflowStudioSyncService.create({ runtime }) };
}

describe("WorkflowStudioSyncService", () => {
  describe("when the engine answers", () => {
    it("dispatches to the project's engine and returns the parsed run answer", async () => {
      const { calls, service } = buildService({
        ok: true,
        status: 200,
        statusText: "OK",
        body: { status: "success", result: { passed: true } },
      });

      const answer = await service.execute({
        projectId: "project_1",
        event,
        origin: "evaluation",
        causalityDepth: 2,
      });

      expect(calls).toEqual([
        { projectId: "project_1", body: event, origin: "evaluation", causalityDepth: 2 },
      ]);
      expect(answer).toEqual({ status: "success", result: { passed: true } });
    });
  });

  describe("when the engine refuses", () => {
    it("throws workflow_execution_failed", async () => {
      const { service } = buildService({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        body: "<html>bad gateway</html>",
      });

      await expect(
        service.execute({ projectId: "project_1", event, origin: "evaluation" }),
      ).rejects.toMatchObject({ code: "workflow_execution_failed" });
    });
  });
});
