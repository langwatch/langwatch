/**
 * @vitest-environment node
 * The organization's private endpoint bindings (ADR-203), signed by the parent, ride the child's
 * model calls as headers: the simulator's, the judge's, a prompt target's and, on the direct
 * route, a workflow target's turn. Never in an event body, and never to an HTTP agent target.
 * @see specs/security/org-private-model-endpoints.feature
 */
import {
  PRIVATE_ENDPOINTS_HEADER,
  PRIVATE_ENDPOINTS_PROJECT_HEADER,
} from "@langwatch/model-provider-contract";
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import type { HttpAgentData, WorkflowAgentData } from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

const undiciCalls = vi.hoisted(() => ({ headers: [] as Headers[] }));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetch: async (_url: string, init: { headers: Record<string, string> }) => {
    undiciCalls.headers.push(new Headers(init.headers));
    return new Response("{}", { status: 200 });
  },
}));

import type { ExecuteSyncTransport } from "../channels/execute-sync.channel.ts";
import {
  directExecuteSyncTransport,
  relayExecuteSyncTransport,
} from "../channels/http/http.execute-sync.channel.ts";
import { HttpLitellmModelChannel } from "../channels/http/http.litellm-model.channel.ts";
import type { ScenarioHttp } from "../channels/http/http.serialized-http-agent.channel.ts";
import { HttpSerializedWorkflowAgentChannel } from "../channels/http/http.serialized-workflow-agent.channel.ts";
import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";

/** What the parent signed for the run; the signing itself is tested in the contract. */
const SIGNED = {
  [PRIVATE_ENDPOINTS_HEADER]: "signed-for-acme-prod",
  [PRIVATE_ENDPOINTS_PROJECT_HEADER]: "acme-prod",
};

const INPUT: AgentInput = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

/** The headers the simulator's or judge's model sends to nlpgo's proxy on one call. */
async function modelHeaders(
  privateEndpointsHeaders: Record<string, string> | undefined,
): Promise<Headers> {
  let sent = new Headers();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 401 });
  });
  const model = HttpLitellmModelChannel.create().model({
    litellmParams: { api_key: "sk-test", model: "custom/llama" },
    nlpServiceUrl: "http://nlp.test",
    privateEndpointsHeaders,
  });
  await Promise.resolve(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  ).catch(() => undefined);
  return sent;
}

/** The headers one execute_sync POST carries, over undici's fetch. */
async function transportHeaders(transport: ExecuteSyncTransport): Promise<Headers> {
  undiciCalls.headers = [];
  await transport.post({ event: {}, signal: new AbortController().signal, timeoutMs: 1_000 });
  return undiciCalls.headers[0] ?? new Headers();
}

describe("the scenario child's private endpoint bindings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given the organization bound a hostname", () => {
    describe("when the simulator or judge calls its model", () => {
      /** @scenario "<path> reaches the private endpoint through a bound hostname" */
      it("sends the signed bindings and their project to nlpgo's proxy", async () => {
        const sent = await modelHeaders(SIGNED);

        expect(sent.get(PRIVATE_ENDPOINTS_HEADER)).toBe("signed-for-acme-prod");
        expect(sent.get(PRIVATE_ENDPOINTS_PROJECT_HEADER)).toBe("acme-prod");
      });
    });

    describe("when a workflow target runs a turn", () => {
      it("never puts the bindings in the execute_flow event", async () => {
        const events: unknown[] = [];
        const transport: ExecuteSyncTransport = {
          endpoint: "http://nlp.test/go/studio/execute_sync",
          post: async ({ event }) => {
            events.push(event);
            return { ok: false, status: 500, text: async () => "stop" };
          },
        };
        const workflow: WorkflowAgentData = {
          type: "workflow",
          agentId: "agent_wf",
          workflowId: "wf_1",
          workflow: { workflow_id: "wf_1", nodes: [], edges: [] },
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          secrets: {},
        };

        await HttpSerializedWorkflowAgentChannel.create({
          config: workflow,
          nlpServiceUrl: "http://nlp.test",
          projectApiKey: "run-key",
          transport,
          privateEndpointsHeaders: SIGNED,
        })
          .call(INPUT)
          .catch(() => undefined);

        expect(events).toHaveLength(1);
        expect(JSON.stringify(events[0])).not.toContain("private_endpoints");
        expect(JSON.stringify(events[0])).not.toContain("signed-for-acme-prod");
      });
    });

    describe("when a workflow turn posts straight to the engine", () => {
      it("sends the signed headers with it", async () => {
        const sent = await transportHeaders(
          directExecuteSyncTransport({
            nlpServiceUrl: "http://nlp.test",
            privateEndpointsHeaders: SIGNED,
          }),
        );

        expect(sent.get(PRIVATE_ENDPOINTS_HEADER)).toBe("signed-for-acme-prod");
        expect(sent.get(PRIVATE_ENDPOINTS_PROJECT_HEADER)).toBe("acme-prod");
      });
    });

    describe("when a workflow turn goes through the control plane's relay", () => {
      it("sends no bindings: the control plane signs its own", async () => {
        const sent = await transportHeaders(
          relayExecuteSyncTransport({ relayBaseUrl: "http://app.test", projectApiKey: "key" }),
        );

        expect(sent.has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
        expect(sent.has(PRIVATE_ENDPOINTS_PROJECT_HEADER)).toBe(false);
      });
    });

    describe("when an HTTP agent target is called", () => {
      /** @scenario "<path> ignores bindings" */
      it("sends no bindings with the request, in a header or the body", async () => {
        const requests: { url: string; init: unknown }[] = [];
        const httpPort: ScenarioHttp = {
          fetch: async ({ url, init }) => {
            requests.push({ url, init });
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ response: "ok" }),
              text: async () => "ok",
            } as never;
          },
        };
        const http: HttpAgentData = {
          type: "http",
          agentId: "agent_http",
          url: "https://llm.internal.acme.test/",
          method: "POST",
          headers: [],
          secrets: {},
          outputPath: "$.response",
        };

        await SerializedAgentChannelRegistry.create({
          voiceAgents: () => {
            throw new Error("no voice target in this test");
          },
        })
          .build({
            adapterData: http,
            nlpServiceUrl: "http://nlp.test",
            httpPort,
            privateEndpointsHeaders: SIGNED,
          })
          .call(INPUT);

        expect(requests).toHaveLength(1);
        expect(JSON.stringify(requests[0])).not.toContain("signed-for-acme-prod");
        expect(JSON.stringify(requests[0]).toLowerCase()).not.toContain(
          PRIVATE_ENDPOINTS_HEADER.toLowerCase(),
        );
      });
    });
  });

  describe("given the organization bound nothing", () => {
    it("sends no private endpoints header", async () => {
      expect((await modelHeaders(undefined)).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
      expect((await modelHeaders({})).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
    });
  });
});
