/**
 * @vitest-environment node
 *
 * Issue #6634 (key finding i): `workflow.api_key` on the execute_flow
 * request nlpgo receives is the LangWatch PLATFORM API key (`X-Auth-Token`
 * nlpgo uses to call back into the platform — agentblock/workflow_runner.go,
 * evaluatorblock/executor.go, engine.go), never an LLM provider credential.
 * The registry used to pass `modelParams.api_key` (an LLM key) into the
 * workflow/code adapter constructors, which is a latent 401 for any
 * agent/evaluator/custom node in that workflow — masked in scenario runs
 * only because `run_evaluations: false` skips the path that would surface
 * it.
 *
 * These tests exercise `createAdapter` (the actual composition point, not
 * an adapter constructed by hand) and assert on the EMITTED request body —
 * asserting a constructor argument would pass even if the registry still
 * wired the wrong value through, since nothing downstream would catch it.
 *
 * @see specs/scenarios/simulation-run-model-resolution.feature
 *   ("The workflow/code adapter sends the project's platform API key")
 */
import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CodeAgentData,
  HttpAgentData,
  LiteLLMParams,
  WorkflowAgentData,
} from "@langwatch/scenario-contract";
import { createAdapter } from "../index";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const scenarioConfig = {
  name: "Registry test scenario",
  description: "Exercises serialized adapter composition.",
  agents: [],
};

const defaultInput: AgentInput = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "hello" }],
  newMessages: [],
  requestedRole: AgentRole.AGENT,
  scenarioState: {
    config: scenarioConfig,
    description: scenarioConfig.description,
    get messages() {
      return [];
    },
    get threadId() {
      return "thread_1";
    },
    get currentTurn() {
      return 1;
    },
    addMessage() {},
    lastMessage() {
      throw new Error("No messages requested by this test");
    },
    lastUserMessage() {
      throw new Error("No user messages requested by this test");
    },
    lastAgentMessage() {
      throw new Error("No agent messages requested by this test");
    },
    lastToolCall() {
      throw new Error("No tool calls requested by this test");
    },
    hasToolCall() {
      return false;
    },
    rollbackMessagesTo() {
      return [];
    },
  },
  scenarioConfig,
};

// Two DISTINGUISHABLE values — a project (platform) key and an LLM
// provider key — so an assertion that the wrong one landed in the body is
// not vacuously true.
const PROJECT_API_KEY = "lw-platform-key-abc123";
const LLM_API_KEY = "sk-llm-provider-key-xyz789";

const modelParams: LiteLLMParams = {
  api_key: LLM_API_KEY,
  model: "openai/gpt-5-mini",
};

const nlpServiceUrl = "http://localhost:8080";

function nlpResponse(result: Record<string, unknown> | null = { output: "ok" }) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      trace_id: "trace_1",
      status: "success",
      result,
    }),
    text: vi.fn().mockResolvedValue(""),
  };
}

describe("createAdapter — project API key threading", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(nlpResponse());
  });

  describe("given a workflow adapter created via the registry", () => {
    const workflowData: WorkflowAgentData = {
      type: "workflow",
      agentId: "agent_wf",
      workflowId: "wf_1",
      workflow: { workflow_id: "wf_1", nodes: [], edges: [] },
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      secrets: {},
    };

    /** @scenario "The workflow adapter sends the project's platform API key, not an LLM key" */
    it("emits the project API key as workflow.api_key on the outbound request", async () => {
      const adapter = createAdapter({
        adapterData: workflowData,
        modelParams,
        nlpServiceUrl,
        projectApiKey: PROJECT_API_KEY,
      });

      await adapter.call(defaultInput);

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.payload.workflow.api_key).toBe(PROJECT_API_KEY);
      expect(body.payload.workflow.api_key).not.toBe(LLM_API_KEY);
    });
  });

  describe("given a code adapter created via the registry", () => {
    const codeData: CodeAgentData = {
      type: "code",
      agentId: "agent_code",
      code: 'def execute(input):\n    return f"processed: {input}"',
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      secrets: {},
    };

    /** @scenario "The code adapter sends the project's platform API key, not an LLM key" */
    it("emits the project API key as workflow.api_key on the outbound request", async () => {
      const adapter = createAdapter({
        adapterData: codeData,
        modelParams,
        nlpServiceUrl,
        projectApiKey: PROJECT_API_KEY,
      });

      await adapter.call(defaultInput);

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.payload.workflow.api_key).toBe(PROJECT_API_KEY);
      expect(body.payload.workflow.api_key).not.toBe(LLM_API_KEY);
    });
  });

  describe("given an HTTP adapter created via the registry", () => {
    const httpData: HttpAgentData = {
      type: "http",
      agentId: "agent_http",
      url: "https://api.example.com/chat",
      method: "POST",
      headers: [],
      secrets: {},
    };

    /** @scenario "An HTTP target resolves no adapter-role model and consumes no project key" */
    it("builds successfully with no project API key given (the factory consumes neither)", () => {
      // Neither key is passed at all — the http factory's signature takes
      // only { data }. If the registry ever starts requiring one for http,
      // this call becomes a type error and the test file itself fails to
      // compile, which is the point: http must stay the one factory that
      // touches neither key.
      expect(() =>
        createAdapter({
          adapterData: httpData,
          nlpServiceUrl,
        }),
      ).not.toThrow();
    });
  });
});
