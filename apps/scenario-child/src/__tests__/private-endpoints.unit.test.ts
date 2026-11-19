/**
 * @vitest-environment node
 * The organization's private endpoint bindings (ADR-203) ride the child's model calls: the
 * simulator's, the judge's, a prompt target's and a workflow target's LLM blocks. An HTTP agent
 * target never receives them. @see specs/security/org-private-model-endpoints.feature
 */
import { PRIVATE_ENDPOINTS_HEADER } from "@langwatch/model-provider-contract";
import { type AgentInput, AgentRole } from "@langwatch/scenario";
import type { HttpAgentData, WorkflowAgentData } from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExecuteSyncTransport } from "../channels/execute-sync.channel.ts";
import { HttpLitellmModelChannel } from "../channels/http/http.litellm-model.channel.ts";
import type { ScenarioHttp } from "../channels/http/http.serialized-http-agent.channel.ts";
import { HttpSerializedWorkflowAgentChannel } from "../channels/http/http.serialized-workflow-agent.channel.ts";
import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
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
async function modelHeaders(privateEndpoints: (typeof INFERENCE)[] | undefined): Promise<Headers> {
  let sent = new Headers();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 401 });
  });
  const model = HttpLitellmModelChannel.create().model({
    litellmParams: { api_key: "sk-test", model: "custom/llama" },
    nlpServiceUrl: "http://nlp.test",
    privateEndpoints,
  });
  await Promise.resolve(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  ).catch(() => undefined);
  return sent;
}

describe("the scenario child's private endpoint bindings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given the organization bound a hostname", () => {
    describe("when the simulator or judge calls its model", () => {
      /** @scenario "<path> reaches the private endpoint through a bound hostname" */
      it("sends the bindings to nlpgo's proxy in the private endpoints header", async () => {
        const header = (await modelHeaders([INFERENCE])).get(PRIVATE_ENDPOINTS_HEADER);

        expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString("utf8"))).toEqual([
          INFERENCE,
        ]);
      });
    });

    describe("when a workflow target runs a turn", () => {
      it("carries the bindings in the execute_flow payload", async () => {
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
          privateEndpoints: [INFERENCE],
        })
          .call(INPUT)
          .catch(() => undefined);

        expect(events[0]).toMatchObject({ payload: { private_endpoints: [INFERENCE] } });
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
            privateEndpoints: [INFERENCE],
          })
          .call(INPUT);

        expect(requests).toHaveLength(1);
        expect(JSON.stringify(requests[0])).not.toContain("10.20.");
        expect(JSON.stringify(requests[0]).toLowerCase()).not.toContain(
          PRIVATE_ENDPOINTS_HEADER.toLowerCase(),
        );
      });
    });
  });

  describe("given the organization bound nothing", () => {
    it("sends no private endpoints header", async () => {
      expect((await modelHeaders(undefined)).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
      expect((await modelHeaders([])).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
    });
  });
});
