/**
 * @vitest-environment node
 *
 * Pin which Studio event types route through the Go engine when
 * `release_nlp_go_engine_enabled` is on for the project.
 *
 * Regression history:
 *   The first wiring of nlpgo into Studio only added execute_flow,
 *   execute_component, and execute_evaluation to GO_ENGINE_EVENT_TYPES.
 *   Heartbeats (is_alive) and stop_execution were left routing to the
 *   legacy Python /studio/execute endpoint, so any operator who ran
 *   nlpgo with NLPGO_CHILD_BYPASS=true (or whose uvicorn child died)
 *   saw the Studio UI stuck in 'Connecting...' with a misleading
 *   'Failed run workflow: Bad Gateway' toast firing on the heartbeat
 *   tick — and Run/Playground/Publish disabled. Caught during browser
 *   QA dogfood by sarah + ash; PR #3483.
 *
 * The contract: every event the Studio sends in the FF-on hot path
 * MUST land on /go/studio/execute. If a future refactor drops one
 * from GO_ENGINE_EVENT_TYPES this test fails with the offending type
 * named.
 *
 * Pure routing test — no nlpgo subprocess, no live OpenAI. The
 * existing post-event.integration.test.ts covers the actual /go/
 * round-trip end-to-end.
 */
import { describe, expect, it, vi } from "vitest";

import type { StudioClientEvent } from "../../../../../optimization_studio/types/events";

vi.mock("../../../../../server/featureFlag/featureFlag.service", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(true),
  },
}));

// `isNlpGoEnabled` resolves the project's organization via Prisma. Unit
// shards have no DB, so the live import throws PrismaClientInitializationError
// before the FF mock above is ever consulted. Stub the gate directly to
// keep this a pure routing test.
vi.mock("../../../../../server/nlpgo/nlpgoFetch", () => ({
  isNlpGoEnabled: vi.fn().mockResolvedValue(true),
}));

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
      // Routing happens before the first read so the path capture isn't
      // dependent on what the body contains, but a clean stream keeps
      // test output free of misleading errors.
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

const FF_ON_EVENT_TYPES = [
  "execute_flow",
  "execute_component",
  "execute_evaluation",
  "is_alive",
  "stop_execution",
] as const;

describe("studioBackendPostEvent routing when FF is on", () => {
  for (const eventType of FF_ON_EVENT_TYPES) {
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
        `event type "${eventType}" must route to the Go engine when FF is on; ` +
          `if you removed it from GO_ENGINE_EVENT_TYPES in post-event.ts, ` +
          `Studio will silently fall back to the Python sidecar — see PR #3483 dogfood for the UX impact`,
      ).toEqual(["/go/studio/execute"]);
    });
  }

  it("execute_optimization is rejected before routing (DSPy is gone on the Go path)", async () => {
    capturedPaths.length = 0;
    const { studioBackendPostEvent } = await import("../post-event");
    // execute_optimization is the one event type intentionally excluded
    // from the Go engine — DSPy was dropped per owner directive. The
    // route layer returns 410 before this function is called, but if
    // someone bypasses the route guard, we still want to NOT route
    // through the Go engine (no /go/ entry exists for it).
    const event: StudioClientEvent = {
      type: "execute_optimization",
      payload: {
        run_id: "r",
        workflow: minimalWorkflow as any,
        workflow_version_id: "v",
        optimizer: "MIPROv2ZeroShot" as any,
        params: {} as any,
      },
    };
    await studioBackendPostEvent({
      projectId: "any-project",
      message: event,
      onEvent: () => {},
    });
    // Either the legacy path (if a future refactor lets it through) or
    // an empty array (current behavior with the route-layer 410 + this
    // function's GO_ENGINE_EVENT_TYPES gating). Both are acceptable;
    // the assertion is "MUST NOT route to /go/".
    expect(capturedPaths).not.toContain("/go/studio/execute");
  });
});
