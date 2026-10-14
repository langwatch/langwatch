/** A peer's synchronous Studio event reaches the project's engine and comes back parsed. */

import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type {
  WorkflowNlpDispatchInput,
  WorkflowNlpDispatchResponse,
  WorkflowNlpRuntime,
} from "../../app/workflow.app.ts";
import { WorkflowStudioSyncService } from "../workflow-studio-sync.service.ts";

const event: StudioClientEvent = { type: "is_alive", payload: {} };

function buildService(answer: { ok: boolean; status: number; statusText: string; text: string }) {
  const calls: WorkflowNlpDispatchInput[] = [];
  const runtime: WorkflowNlpRuntime = {
    dispatch: async (input): Promise<WorkflowNlpDispatchResponse> => {
      calls.push(input);
      return {
        ok: answer.ok,
        status: answer.status,
        statusText: answer.statusText,
        json: () => Promise.reject(new Error("the service reads text")),
        text: async () => answer.text,
      };
    },
  };

  return { calls, service: WorkflowStudioSyncService.create({ runtime }) };
}

describe("WorkflowStudioSyncService", () => {
  describe("when the engine answers with JSON", () => {
    it("dispatches to the project's engine and returns the parsed body", async () => {
      const { calls, service } = buildService({
        ok: true,
        status: 200,
        statusText: "OK",
        text: '{"status":"success","result":{"passed":true}}',
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
      expect(answer).toEqual({
        ok: true,
        status: 200,
        statusText: "OK",
        body: { status: "success", result: { passed: true } },
      });
    });
  });

  describe("when the engine answers with a non-JSON page", () => {
    it("returns the page as text", async () => {
      const { service } = buildService({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: "<html>bad gateway</html>",
      });

      const answer = await service.execute({ projectId: "project_1", event, origin: "evaluation" });

      expect(answer).toEqual({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        body: "<html>bad gateway</html>",
      });
    });
  });
});
