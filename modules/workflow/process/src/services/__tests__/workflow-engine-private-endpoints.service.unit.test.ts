/** @see specs/security/org-private-model-endpoints.feature */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { WorkflowNlpDispatchInput } from "../../app/workflow.app.ts";
import type { WorkflowStudioStreamInput } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowEnginePrivateEndpointsService } from "../workflow-engine-private-endpoints.service.ts";

/** What the model-provider module signs for acme-prod; the signing itself is tested there. */
const ACME_HEADERS = {
  "X-LangWatch-Private-Endpoints": "signed-for-acme-prod",
  "X-LangWatch-Project-Id": "acme-prod",
};

const HEADERS: Record<string, Record<string, string>> = { "acme-prod": ACME_HEADERS };

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
      privateEndpointsHeadersForProject: async ({ projectId }) => {
        asked.push(projectId);
        return HEADERS[projectId] ?? {};
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

const FORGED = [{ hostname: "evil.test", addresses: ["10.0.0.1"], port: 443 }];
const FORGED_HEADERS = {
  "X-LangWatch-Private-Endpoints": "evil.test",
  "X-LangWatch-Project-Id": "x",
};

describe("WorkflowEnginePrivateEndpointsService", () => {
  describe("given a project whose organization bound a hostname", () => {
    describe("when a run is opened on the streaming route", () => {
      /** @scenario "<path> reaches the private endpoint through a bound hostname" */
      it("hands the signed headers to the transport and leaves the event as sent", async () => {
        const { stream, opened } = setup();

        await stream.open({ projectId: "acme-prod", body: runEvent as never, origin: "workflow" });

        expect(opened[0]?.privateEndpointsHeaders).toEqual(ACME_HEADERS);
        expect(opened[0]?.body).toEqual(runEvent);
      });
    });

    describe("when a run is dispatched on the synchronous route", () => {
      it("hands the signed headers to the transport there too", async () => {
        const { runtime, dispatched } = setup();

        await runtime.dispatch({ projectId: "acme-prod", body: runEvent, origin: "scenario" });

        expect(dispatched[0]?.privateEndpointsHeaders).toEqual(ACME_HEADERS);
        expect(dispatched[0]?.body).toEqual(runEvent);
      });
    });

    describe("when the graph holds an HTTP block", () => {
      /** @scenario "<path> ignores bindings" */
      it("never writes the bindings into the graph", async () => {
        const { runtime, dispatched } = setup();

        await runtime.dispatch({ projectId: "acme-prod", body: runEvent, origin: "workflow" });

        expect(JSON.stringify(dispatched[0]?.body)).not.toContain("10.20.");
      });
    });
  });

  describe("given a sender that names its own bindings", () => {
    const cases: Record<string, WorkflowNlpDispatchInput["body"]> = {
      "a flat body with a top-level field": {
        ...runEvent.payload,
        private_endpoints: FORGED,
      },
      "a payload with the field and no workflow": {
        type: "execute_component",
        payload: { private_endpoints: FORGED },
      },
      "a discriminated envelope with the field at the top and in the payload": {
        type: "execute_flow",
        private_endpoints: FORGED,
        payload: { ...runEvent.payload, private_endpoints: FORGED },
      },
    };

    for (const [name, body] of Object.entries(cases)) {
      it(`drops the field from ${name}`, async () => {
        const { runtime, dispatched } = setup();

        await runtime.dispatch({ projectId: "acme-prod", body, origin: "workflow" });

        expect(JSON.stringify(dispatched[0]?.body)).not.toContain("private_endpoints");
        expect(JSON.stringify(dispatched[0])).not.toContain("evil.test");
      });
    }

    it("leaves a deeper key of that name in the workflow data untouched", async () => {
      const { runtime, dispatched } = setup();
      const row = { question: "which?", private_endpoints: "a tenant's own column" };
      const nodeParams = { id: "code", type: "code", data: { private_endpoints: ["keep"] } };
      const body = {
        type: "execute_flow",
        payload: {
          ...runEvent.payload,
          workflow: { ...runEvent.payload.workflow, nodes: [nodeParams] },
          inputs: [row],
        },
      };

      await runtime.dispatch({ projectId: "acme-prod", body, origin: "workflow" });

      expect(dispatched[0]?.body).toEqual(body);
    });

    it("replaces headers the caller put on the input with the organization's", async () => {
      const { runtime, stream, dispatched, opened } = setup();

      await runtime.dispatch({
        projectId: "acme-prod",
        body: runEvent,
        origin: "workflow",
        privateEndpointsHeaders: FORGED_HEADERS,
      });
      await stream.open({
        projectId: "rival-prod",
        body: runEvent as never,
        origin: "workflow",
        privateEndpointsHeaders: FORGED_HEADERS,
      });

      expect(dispatched[0]?.privateEndpointsHeaders).toEqual(ACME_HEADERS);
      expect(opened[0]?.privateEndpointsHeaders).toEqual({});
    });
  });

  describe("given an organization with no binding", () => {
    it("hands the transport no headers", async () => {
      const { runtime, dispatched } = setup();

      await runtime.dispatch({ projectId: "rival-prod", body: runEvent, origin: "workflow" });

      expect(dispatched[0]?.privateEndpointsHeaders).toEqual({});
      expect(dispatched[0]?.body).toEqual(runEvent);
    });
  });

  describe("given an event that runs no graph", () => {
    it("sends it as it was without asking for bindings", async () => {
      const { runtime, dispatched, asked } = setup();
      const probe = { type: "is_alive", payload: {} };

      await runtime.dispatch({ projectId: "acme-prod", body: probe, origin: "workflow" });

      expect(dispatched[0]?.body).toBe(probe);
      expect(dispatched[0]?.privateEndpointsHeaders).toEqual({});
      expect(asked).toEqual([]);
    });
  });
});
