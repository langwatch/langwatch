/** @see specs/security/org-private-model-endpoints.feature */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { WorkflowNlpDispatchInput } from "../../app/workflow.app.ts";
import type { WorkflowStudioStreamInput } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowEnginePrivateEndpointsService } from "../workflow-engine-private-endpoints.service.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

const BINDINGS: Record<string, (typeof INFERENCE)[]> = { "acme-prod": [INFERENCE] };

/** A graph with an LLM block and an HTTP block, both aimed at the bound hostname. */
const runEvent = {
  type: "execute_flow",
  payload: {
    trace_id: "trace-1",
    workflow: {
      nodes: [
        {
          id: "llm",
          type: "signature",
          data: { llm: { litellm_params: { api_base: "https://llm.internal.acme.test/v1" } } },
        },
        { id: "http", type: "http", data: { url: "https://llm.internal.acme.test/" } },
      ],
      edges: [],
    },
    inputs: [{}],
  },
};

function setup() {
  const asked: string[] = [];
  const opened: WorkflowStudioStreamInput[] = [];
  const dispatched: WorkflowNlpDispatchInput[] = [];
  const service = WorkflowEnginePrivateEndpointsService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      privateEndpointBindingsForProject: async ({ projectId }) => {
        asked.push(projectId);
        return BINDINGS[projectId] ?? [];
      },
    }),
  });
  const stream = service.boundStream({
    open: async (input) => {
      opened.push(input);
      return new ReadableStream<Uint8Array>().getReader();
    },
  });
  const runtime = service.boundRuntime({
    dispatch: async (input) => {
      dispatched.push(input);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
        text: async () => "",
      };
    },
  });
  return { stream, runtime, asked, opened, dispatched };
}

describe("WorkflowEnginePrivateEndpointsService", () => {
  describe("given a project whose organization bound a hostname", () => {
    describe("when a run is opened on the streaming route", () => {
      /** @scenario "<path> reaches the private endpoint through a bound hostname" */
      it("carries the bindings in the payload's private_endpoints and leaves the graph as sent", async () => {
        const { stream, opened } = setup();

        await stream.open({ projectId: "acme-prod", body: runEvent as never, origin: "workflow" });

        expect(opened[0]?.body).toEqual({
          ...runEvent,
          payload: { ...runEvent.payload, private_endpoints: [INFERENCE] },
        });
      });
    });

    describe("when a run is dispatched on the synchronous route", () => {
      it("carries the bindings there too", async () => {
        const { runtime, dispatched } = setup();

        await runtime.dispatch({ projectId: "acme-prod", body: runEvent, origin: "scenario" });

        expect(dispatched[0]?.body).toMatchObject({ payload: { private_endpoints: [INFERENCE] } });
      });
    });

    describe("when the graph holds an HTTP block", () => {
      /** @scenario "<path> ignores bindings" */
      it("puts the bindings only at the payload's top level, never on the HTTP block", async () => {
        const { runtime, dispatched } = setup();

        await runtime.dispatch({ projectId: "acme-prod", body: runEvent, origin: "workflow" });

        const sent = dispatched[0]?.body as typeof runEvent;
        expect(sent.payload.workflow).toEqual(runEvent.payload.workflow);
        expect(JSON.stringify(sent.payload.workflow)).not.toContain("10.20.");
      });
    });
  });

  describe("given a sender that names its own private_endpoints", () => {
    it("drops them and sends only the organization's", async () => {
      const { runtime, dispatched } = setup();
      const forged = {
        type: "execute_flow",
        private_endpoints: [{ hostname: "evil.test", addresses: ["10.0.0.1"], port: 443 }],
        payload: {
          ...runEvent.payload,
          private_endpoints: [{ hostname: "evil.test", addresses: ["10.0.0.1"], port: 443 }],
        },
      };

      await runtime.dispatch({ projectId: "rival-prod", body: forged, origin: "workflow" });

      expect(JSON.stringify(dispatched[0]?.body)).not.toContain("evil.test");
    });
  });

  describe("given an organization with no binding", () => {
    it("sends no private_endpoints field", async () => {
      const { runtime, dispatched } = setup();

      await runtime.dispatch({ projectId: "rival-prod", body: runEvent, origin: "workflow" });

      expect(dispatched[0]?.body).toEqual(runEvent);
    });
  });

  describe("given an event that runs no graph", () => {
    it("sends it as it was without asking for bindings", async () => {
      const { runtime, dispatched, asked } = setup();
      const probe = { type: "is_alive", payload: {} };

      await runtime.dispatch({ projectId: "acme-prod", body: probe, origin: "workflow" });

      expect(dispatched[0]?.body).toBe(probe);
      expect(asked).toEqual([]);
    });
  });
});
