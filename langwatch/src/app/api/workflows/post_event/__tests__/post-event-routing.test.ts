/**
 * @vitest-environment node
 *
 * Pin that studioBackendPostEvent routes every Studio event to the Go
 * engine at /go/studio/execute. With the Python langwatch_nlp service
 * removed, nlpgo is the only engine and there is no per-event or
 * per-project gating left — every event that reaches this function goes
 * to /go/. (execute_optimization is rejected with 410 one layer up, in
 * routes/workflows.ts, before it ever reaches here.)
 *
 * Pure routing test — no nlpgo subprocess, no live OpenAI. The existing
 * post-event.integration.test.ts covers the actual /go/ round-trip
 * end-to-end.
 */
import { describe, expect, it, vi } from "vitest";

import type { StudioClientEvent } from "../../../../../optimization_studio/types/events";

vi.mock("../../../../../optimization_studio/server/addEnvs", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../optimization_studio/server/addEnvs")
  >("../../../../../optimization_studio/server/addEnvs");
  return {
    ...actual,
    getS3CacheKey: () => undefined,
  };
});

const capturedPaths: string[] = [];
vi.mock("../../../../../optimization_studio/server/lambda", () => ({
  invokeLambda: vi.fn(
    async (
      _projectId: string,
      _event: StudioClientEvent,
      _s3CacheKey: string | undefined,
      options: { path?: string } = {},
    ) => {
      capturedPaths.push(options.path ?? "/studio/execute");
      // One valid `done` frame so studioBackendPostEvent's reader exits
      // cleanly via its `serverEvent.type === "done"` short-circuit
      // instead of logging a "Studio invalid response" error on close.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"done"}\n\n'),
          );
          controller.close();
        },
      });
      return stream.getReader();
    },
  ),
}));

const minimalWorkflow = {
  workflow_id: "routing-test",
  api_key: "k",
  spec_version: "1.3",
  name: "routing",
  icon: "🧪",
  description: "",
  version: "1.3",
  template_adapter: "default",
  nodes: [],
  edges: [],
  state: {},
};

const eventByType: Record<string, StudioClientEvent> = {
  execute_flow: {
    type: "execute_flow",
    payload: {
      trace_id: "t",
      workflow: minimalWorkflow as any,
      inputs: [{}],
    },
  },
  execute_component: {
    type: "execute_component",
    payload: {
      trace_id: "t",
      workflow: minimalWorkflow as any,
      node_id: "n",
      inputs: {},
    },
  },
  execute_evaluation: {
    type: "execute_evaluation",
    payload: {
      run_id: "r",
      workflow: minimalWorkflow as any,
      workflow_version_id: "v",
      evaluate_on: "test",
    },
  },
  is_alive: { type: "is_alive", payload: {} },
  stop_execution: {
    type: "stop_execution",
    payload: { trace_id: "t" },
  },
};

const STUDIO_EVENT_TYPES = [
  "execute_flow",
  "execute_component",
  "execute_evaluation",
  "is_alive",
  "stop_execution",
] as const;

describe("studioBackendPostEvent routing", () => {
  for (const eventType of STUDIO_EVENT_TYPES) {
    it(`routes ${eventType} to /go/studio/execute`, async () => {
      capturedPaths.length = 0;
      const { studioBackendPostEvent } = await import("../post-event");
      await studioBackendPostEvent({
        projectId: "any-project",
        message: eventByType[eventType]!,
        onEvent: () => {},
      });
      expect(
        capturedPaths,
        `event type "${eventType}" must route to nlpgo at /go/studio/execute; nlpgo is the only engine`,
      ).toEqual(["/go/studio/execute"]);
    });
  }
});
