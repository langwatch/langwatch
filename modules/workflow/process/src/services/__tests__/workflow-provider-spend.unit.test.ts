/**
 * A studio workflow's LLM node usage reaches the gateway spend ledger from the stream and the
 * synchronous door, once per node, and a ledger failure never reaches the run's caller.
 * @see modules/gateway/specs/gateway-platform-provider-usage.feature
 */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { WorkflowNlpRuntime } from "../../app/workflow.app.ts";
import { MemoryWorkflowProviderSpendChannel } from "../../channels/memory/memory.workflow-provider-spend.channel.ts";
import type { WorkflowStudioStream } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowProviderSpendService } from "../workflow-provider-spend.service.ts";
import { WorkflowStudioDispatchService } from "../workflow-studio-dispatch.service.ts";

const metrics = {
  prompt_tokens: 1200,
  completion_tokens: 300,
  total_tokens: 1500,
  reasoning_tokens: 100,
  cache_read_input_tokens: 200,
  cache_creation_input_tokens: 0,
  model: "openai/gpt-5-mini",
};

const runEvent: StudioClientEvent = {
  type: "execute_flow",
  payload: {
    trace_id: "trace-1",
    workflow: {
      workflow_id: "wf-1",
      spec_version: "1.5",
      name: "Test",
      icon: "x",
      description: "x",
      version: "1.0",
      nodes: [],
      edges: [],
      state: { execution: { status: "idle" } },
    },
  },
};

const llmNodeFinished = {
  type: "component_state_change",
  payload: {
    component_id: "llm_call",
    execution_state: {
      status: "success",
      trace_id: "trace-1",
      metrics,
      timestamps: { started_at: 1000, finished_at: 1450 },
    },
  },
};

function streamOf(events: readonly unknown[]): WorkflowStudioStream {
  const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return {
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frames));
          controller.close();
        },
      }).getReader(),
  };
}

function dispatchOver(events: readonly unknown[], spend: MemoryWorkflowProviderSpendChannel) {
  return WorkflowStudioDispatchService.create({
    stream: streamOf(events),
    modelProviders: createApiFixture<ModelProviderApi>({ getForProject: async () => ({}) }),
    spend: WorkflowProviderSpendService.create({ spend }),
  });
}

async function postAll(service: WorkflowStudioDispatchService): Promise<StudioServerEvent[]> {
  const seen: StudioServerEvent[] = [];
  await service.postEvent({
    projectId: "project-1",
    event: runEvent,
    onEvent: (event) => seen.push(event),
  });
  return seen;
}

function syncRuntime(body: unknown): WorkflowNlpRuntime {
  const text = JSON.stringify(body);
  return {
    dispatch: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    }),
  };
}

describe("given a studio workflow whose LLM node ran on stored provider credentials", () => {
  describe("when the streamed run reports the node finished", () => {
    /** @scenario "A studio workflow's LLM nodes on stored credentials land on the ledger" */
    it("writes the node's usage once as workflow spend, cache apart from fresh input", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create();
      const done = {
        type: "done",
        payload: { status: "success", nodes: { llm_call: { metrics } } },
      };

      await postAll(dispatchOver([llmNodeFinished, done], spend));

      expect(spend.recorded).toEqual([
        {
          requestId: "workflow:trace-1:wf-1:llm_call:openai/gpt-5-mini",
          projectId: "project-1",
          model: "openai/gpt-5-mini",
          requestType: "workflow",
          usage: {
            input_tokens: 1000,
            output_tokens: 300,
            reasoning_tokens: 100,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 0,
          },
          durationMs: 450,
          occurredAt: expect.any(Number),
        },
      ]);
    });
  });

  describe("when an evaluated row's progress event carries its usage", () => {
    it("writes that row's usage under the row's own trace", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create();
      const progress = {
        type: "evaluation_state_change",
        payload: {
          evaluation_state: { status: "running", progress: 1, total: 2 },
          usage: [{ node_id: "llm_call", trace_id: "row-trace", metrics, duration_ms: 20 }],
        },
      };

      await postAll(dispatchOver([progress], spend));

      expect(spend.recorded.map((entry) => entry.requestId)).toEqual([
        "workflow:row-trace:wf-1:llm_call:openai/gpt-5-mini",
      ]);
    });
  });

  describe("when a node is still running or failed", () => {
    it("writes nothing for it", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create();
      const running = {
        ...llmNodeFinished,
        payload: {
          ...llmNodeFinished.payload,
          execution_state: { status: "running", trace_id: "trace-1" },
        },
      };

      await postAll(dispatchOver([running], spend));

      expect(spend.recorded).toEqual([]);
    });
  });

  describe("when a synchronous run answers with its node states", () => {
    it("writes every LLM node's usage and hands the caller the answer unread", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create();
      const answer = {
        trace_id: "trace-2",
        status: "success",
        result: { answer: "4" },
        nodes: {
          entry: { id: "entry", status: "success" },
          llm_call: { id: "llm_call", status: "success", metrics, duration_ms: 30 },
        },
      };
      const runtime = WorkflowProviderSpendService.create({ spend }).meteredRuntime(
        syncRuntime(answer),
      );

      const response = await runtime.dispatch({
        projectId: "project-1",
        body: runEvent,
        origin: "workflow",
      });

      expect(await response.json()).toEqual(answer);
      expect(spend.recorded.map((entry) => entry.requestId)).toEqual([
        "workflow:trace-2:wf-1:llm_call:openai/gpt-5-mini",
      ]);
    });
  });
});

describe("given a spend pipeline that refuses or fails on a node's usage", () => {
  describe("when the streamed run answers", () => {
    /** @scenario "A ledger refusal never fails the workflow" */
    it("delivers every event unchanged and resolves", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create({
        answer: () => Promise.reject(new Error("ledger down")),
      });

      const seen = await postAll(dispatchOver([llmNodeFinished, { type: "done" }], spend));

      expect(seen.map((event) => event.type)).toEqual(["component_state_change", "done"]);
      expect(spend.recorded).toHaveLength(1);
    });
  });

  describe("when a synchronous run answers", () => {
    it("returns the answer unchanged", async () => {
      const spend = MemoryWorkflowProviderSpendChannel.create({
        answer: () => Promise.resolve({ status: "unattributed" }),
      });
      const answer = { trace_id: "trace-3", nodes: { llm_call: { metrics } } };
      const runtime = WorkflowProviderSpendService.create({ spend }).meteredRuntime(
        syncRuntime(answer),
      );

      const response = await runtime.dispatch({
        projectId: "project-1",
        body: runEvent,
        origin: "workflow",
      });

      expect(await response.text()).toBe(JSON.stringify(answer));
    });
  });
});
