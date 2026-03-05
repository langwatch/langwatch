/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAgentData } from "../../types";
import { SerializedCodeAgentAdapter } from "../code-agent.adapter";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SerializedCodeAgentAdapter", () => {
  const defaultConfig: CodeAgentData = {
    type: "code",
    agentId: "agent_123",
    code: 'def execute(input):\n    return f"processed: {input}"',
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
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
      nlpResponse({ output: "processed: Hello" }),
    );
  });

  it("has AGENT role", () => {
    const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
    expect(adapter.name).toBe("SerializedCodeAgentAdapter");
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /studio/execute_sync", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

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
      expect(callBody.payload.workflow.api_key).toBe(apiKey);
      expect(callBody.payload.workflow.template_adapter).toBe("default");
    });

    it("builds a workflow with entry, code, and end nodes", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const nodeIds = callBody.payload.workflow.nodes.map(
        (n: { id: string }) => n.id,
      );
      expect(nodeIds).toEqual(["entry", "code_agent", "end"]);

      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.parameters[0].value).toBe(defaultConfig.code);
    });

    it("returns the end node output as a response string", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

      const result = await adapter.call(defaultInput);

      expect(result).toBe("processed: Hello");
    });
  });

  describe("when the code execution fails", () => {
    it("extracts error detail from JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Python runtime error" }),
        text: vi.fn().mockResolvedValue('{"detail": "Python runtime error"}'),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Code execution failed: HTTP 500 - Python runtime error",
      );
    });

    it("falls back to text when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Bad Gateway"),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Code execution failed: HTTP 502 - Bad Gateway",
      );
    });
  });

  describe("when agent has no explicit inputs/outputs", () => {
    it("uses default input/output identifiers", async () => {
      const configNoIO: CodeAgentData = {
        ...defaultConfig,
        inputs: [],
        outputs: [],
      };

      const adapter = new SerializedCodeAgentAdapter(configNoIO, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].identifier).toBe("input");
      expect(codeNode.data.outputs[0].identifier).toBe("output");
    });
  });

  describe("when the NLP service returns end node output", () => {
    it("extracts the first output by identifier", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ output: "nested result" }),
      );

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("nested result");
    });

    it("returns empty string when result is null", async () => {
      mockFetch.mockResolvedValue(nlpResponse(null));

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
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

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(multiMessageInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].value).toBe("Second message");
    });
  });

  describe("when agent has multiple inputs", () => {
    it("sets only the first input to the message value", async () => {
      const multiInputConfig: CodeAgentData = {
        ...defaultConfig,
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "context", type: "str" },
        ],
      };

      const adapter = new SerializedCodeAgentAdapter(multiInputConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].value).toBe("Hello");
      expect(codeNode.data.inputs[1].value).toBe("");
    });
  });

  describe("when sending the request to the NLP service", () => {
    it("passes an abort signal for timeout protection", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.run_evaluations).toBe(false);
      expect(callBody.payload.do_not_trace).toBe(true);
    });

    it("generates a valid 32-char hex trace_id", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.trace_id).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("when building the workflow", () => {
    it("includes a valid dataset on the entry node", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const entryNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "entry",
      );
      expect(entryNode.data.dataset).toEqual({
        id: "scenario-input",
        name: "Scenario Input",
        inline: null,
      });
    });

    it("connects entry -> code_agent -> end with correct edge handles", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const edges = callBody.payload.workflow.edges;

      // entry -> code_agent edge
      const entryToCode = edges.find(
        (e: { source: string; target: string }) =>
          e.source === "entry" && e.target === "code_agent",
      );
      expect(entryToCode.sourceHandle).toBe("outputs.input");
      expect(entryToCode.targetHandle).toBe("inputs.input");

      // code_agent -> end edge
      const codeToEnd = edges.find(
        (e: { source: string; target: string }) =>
          e.source === "code_agent" && e.target === "end",
      );
      expect(codeToEnd.sourceHandle).toBe("outputs.output");
      expect(codeToEnd.targetHandle).toBe("inputs.output");
    });
  });
});
