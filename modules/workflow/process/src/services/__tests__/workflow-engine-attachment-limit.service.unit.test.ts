/** @see modules/workflow/specs/workflow-service.feature */
import { DATASET_DEFAULT_LIMITS, type DatasetApi } from "@langwatch/dataset-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { studioClientEventSchema } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { WorkflowNlpDispatchInput } from "../../app/workflow.app.ts";
import type { WorkflowStudioStreamInput } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowEngineAttachmentLimitService } from "../workflow-engine-attachment-limit.service.ts";

const MB = 1024 * 1024;
const RAISED = 512 * MB;

const runEvent = studioClientEventSchema.parse({
  type: "execute_component",
  payload: {
    trace_id: "trace-1",
    workflow: {
      workflow_id: "wf-1",
      api_key: "k",
      spec_version: "1.4",
      name: "Test",
      icon: "x",
      description: "x",
      version: "1.0",
      template_adapter: "default",
      default_llm: { model: "openai/gpt-5-mini" },
      nodes: [],
      edges: [],
      state: { execution: { status: "idle" } },
    },
    node_id: "node-1",
    inputs: {},
  },
});

function setup(attachmentBytes: number | Error = RAISED) {
  const asked: string[] = [];
  const opened: WorkflowStudioStreamInput[] = [];
  const dispatched: WorkflowNlpDispatchInput[] = [];
  const limits = WorkflowEngineAttachmentLimitService.create({
    datasets: createApiFixture<DatasetApi>({
      getLimits: async ({ projectId }) => {
        asked.push(projectId);
        if (attachmentBytes instanceof Error) throw attachmentBytes;

        return { ...DATASET_DEFAULT_LIMITS, attachmentBytes };
      },
    }),
  });
  const stream = limits.limitedStream({
    open: async (input) => {
      opened.push(input);

      return new ReadableStream<Uint8Array>().getReader();
    },
  });
  const runtime = limits.limitedRuntime({
    dispatch: async (input) => {
      dispatched.push(input);

      return { ok: true, status: 200, statusText: "OK", json: async () => ({}), text: async () => "" };
    },
  });

  return { stream, runtime, asked, opened, dispatched };
}

describe("given a project whose organization answers its own file limit", () => {
  describe("when a run is opened on the streaming route", () => {
    /** @scenario "Every run sent to the engine carries the organization's file limit" */
    it("names the limit in the event's payload and leaves the rest as sent", async () => {
      const { stream, opened } = setup();

      await stream.open({ projectId: "project-1", body: runEvent, origin: "evaluation" });

      expect(opened).toEqual([
        {
          projectId: "project-1",
          origin: "evaluation",
          body: { ...runEvent, payload: { ...runEvent.payload, max_attachment_bytes: RAISED } },
        },
      ]);
    });
  });

  describe("when a run is dispatched on the synchronous route", () => {
    /** @scenario "Every run sent to the engine carries the organization's file limit" */
    it("names the limit on a relayed event too", async () => {
      const { runtime, dispatched } = setup();
      const relayed = { type: "execute_flow", payload: { workflow: {}, inputs: [{}] } };

      await runtime.dispatch({ projectId: "project-1", body: relayed, origin: "scenario" });

      expect(dispatched[0]?.body).toEqual({
        type: "execute_flow",
        payload: { workflow: {}, inputs: [{}], max_attachment_bytes: RAISED },
      });
    });
  });

  describe("when several runs of one project are sent", () => {
    /** @scenario "Every run sent to the engine carries the organization's file limit" */
    it("asks for the limit once", async () => {
      const { stream, runtime, asked } = setup();

      await stream.open({ projectId: "project-1", body: runEvent, origin: "evaluation" });
      await stream.open({ projectId: "project-1", body: runEvent, origin: "evaluation" });
      await runtime.dispatch({ projectId: "project-1", body: runEvent, origin: "workflow" });

      expect(asked).toEqual(["project-1"]);
    });
  });
});

describe("given an event that runs no graph", () => {
  describe("when it is sent to the engine", () => {
    /** @scenario "Events that run no graph are sent to the engine unchanged" */
    it("sends a liveness probe as it was, without asking for a limit", async () => {
      const { runtime, dispatched, asked } = setup();
      const probe = studioClientEventSchema.parse({ type: "is_alive", payload: {} });

      await runtime.dispatch({ projectId: "project-1", body: probe, origin: "workflow" });

      expect(dispatched[0]?.body).toBe(probe);
      expect(asked).toEqual([]);
    });
  });
});

describe("given the organization's file limit cannot be resolved", () => {
  describe("when a run is sent to the engine", () => {
    /** @scenario "A failed file limit lookup does not stop the run" */
    it("sends the event without a limit", async () => {
      const { stream, opened } = setup(new Error("entitlements unavailable"));

      await stream.open({ projectId: "project-1", body: runEvent, origin: "evaluation" });

      expect(opened[0]?.body).toBe(runEvent);
    });
  });
});
