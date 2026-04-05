/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowAgentData } from "../../types";
import { SerializedWorkflowAdapter } from "../workflow-agent.adapter";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SerializedWorkflowAdapter", () => {
  const sampleDsl = {
    workflow_id: "wf_123",
    spec_version: "1.4",
    name: "Customer Support Bot",
    icon: "🤖",
    description: "Handles customer queries",
    version: "2.0",
    template_adapter: "default",
    default_llm: null,
    nodes: [
      {
        id: "entry",
        type: "entry",
        data: {
          name: "Entry",
          outputs: [
            { identifier: "question", type: "str" },
          ],
        },
      },
      {
        id: "llm_node",
        type: "signature",
        data: { name: "LLM" },
      },
      {
        id: "end",
        type: "end",
        data: {
          name: "End",
          inputs: [
            { identifier: "answer", type: "str" },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "entry", target: "llm_node", type: "default" },
      { id: "e2", source: "llm_node", target: "end", type: "default" },
    ],
    state: { execution: { status: "idle" } },
  };

  const defaultConfig: WorkflowAgentData = {
    type: "workflow",
    agentId: "agent_wf_123",
    workflowDsl: sampleDsl,
    entryInputs: [{ identifier: "question", type: "str" }],
    endOutputs: [{ identifier: "answer", type: "str" }],
  };

  const nlpServiceUrl = "http://localhost:8080";
  const apiKey = "test-api-key";

  /** NLP service /studio/execute_sync response format */
  const nlpResponse = (result: Record<string, unknown> | null) => ({
    ok: true,
    json: vi.fn().mockResolvedValue({
      trace_id: "trace_abc123",
      status: "success",
      result,
    }),
    text: vi.fn().mockResolvedValue(""),
  });

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(
      nlpResponse({ answer: "I can help you with that" }),
    );
  });

  it("has AGENT role", () => {
    const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
    expect(adapter.name).toBe("SerializedWorkflowAdapter");
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /studio/execute_sync", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      expect(mockFetch).toHaveBeenCalledWith(
        `${nlpServiceUrl}/studio/execute_sync`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.type).toBe("execute_flow");
    });

    it("sends the stored workflow DSL with api_key injected", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.workflow.api_key).toBe(apiKey);
      expect(callBody.payload.workflow.name).toBe("Customer Support Bot");
      expect(callBody.payload.workflow.nodes).toHaveLength(3);
    });

    it("passes the input message as the entry node input", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.inputs).toEqual([{ question: "Hello" }]);
    });

    it("returns the end node output as a response string", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      const result = await adapter.call(defaultInput);

      expect(result).toBe("I can help you with that");
    });
  });

  describe("when the workflow execution fails", () => {
    it("extracts error detail from JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Workflow node failed" }),
        text: vi.fn().mockResolvedValue('{"detail": "Workflow node failed"}'),
      });

      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Workflow execution failed: HTTP 500 - Workflow node failed",
      );
    });

    it("falls back to text when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Bad Gateway"),
      });

      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Workflow execution failed: HTTP 502 - Bad Gateway",
      );
    });
  });

  describe("when the NLP service returns end node output", () => {
    it("extracts the first output by identifier", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ answer: "nested result" }),
      );

      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("nested result");
    });

    it("returns empty string when result is null", async () => {
      mockFetch.mockResolvedValue(nlpResponse(null));

      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("");
    });
  });

  describe("when the adapter uses last user message", () => {
    it("extracts content from the last user message in the conversation", async () => {
      const multiMessageInput: AgentInput = {
        ...defaultInput,
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" },
        ],
      };

      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(multiMessageInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.inputs).toEqual([{ question: "Second message" }]);
    });
  });

  describe("when agent has multiple entry inputs", () => {
    it("sets only the first input to the message value", async () => {
      const multiInputConfig: WorkflowAgentData = {
        ...defaultConfig,
        entryInputs: [
          { identifier: "question", type: "str" },
          { identifier: "context", type: "str" },
        ],
      };

      const adapter = new SerializedWorkflowAdapter(multiInputConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.inputs).toEqual([
        { question: "Hello", context: "" },
      ]);
    });
  });

  describe("when sending the request to the NLP service", () => {
    it("passes an abort signal for timeout protection", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.run_evaluations).toBe(false);
      expect(callBody.payload.do_not_trace).toBe(true);
    });

    it("generates a valid 32-char hex trace_id", async () => {
      const adapter = new SerializedWorkflowAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.trace_id).toMatch(/^[0-9a-f]{32}$/);
    });
  });
});
