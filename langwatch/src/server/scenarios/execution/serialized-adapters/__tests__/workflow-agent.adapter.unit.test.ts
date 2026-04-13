/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowAgentData } from "../../types";
import { SerializedWorkflowAgentAdapter } from "../workflow-agent.adapter";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SerializedWorkflowAgentAdapter", () => {
  /** Minimal published workflow DSL with an entry node, a signature node, and an end node. */
  const defaultDsl: Record<string, unknown> = {
    workflow_id: "wf_1",
    name: "Greeter",
    nodes: [
      {
        id: "entry",
        type: "entry",
        data: {
          name: "Entry",
          outputs: [{ identifier: "input", type: "str" }],
        },
      },
      {
        id: "greeter",
        type: "signature",
        data: { name: "Greeter" },
      },
      {
        id: "end",
        type: "end",
        data: {
          name: "End",
          inputs: [{ identifier: "output", type: "str" }],
        },
      },
    ],
    edges: [
      {
        id: "entry-greeter",
        source: "entry",
        sourceHandle: "outputs.input",
        target: "greeter",
        targetHandle: "inputs.input",
      },
      {
        id: "greeter-end",
        source: "greeter",
        sourceHandle: "outputs.output",
        target: "end",
        targetHandle: "inputs.output",
      },
    ],
    state: { execution: { status: "idle" } },
  };

  const defaultConfig: WorkflowAgentData = {
    type: "workflow",
    agentId: "agent_wf_1",
    workflowId: "wf_1",
    workflow: defaultDsl,
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  };

  const nlpServiceUrl = "http://localhost:8080";
  const apiKey = "test-api-key";

  /** NLP service /studio/execute_sync response format. */
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
    mockFetch.mockResolvedValue(nlpResponse({ output: "Hi there!" }));
  });

  describe("basic contract", () => {
    it("has AGENT role", () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      expect(adapter.role).toBe(AgentRole.AGENT);
    });

    it("has correct name", () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      expect(adapter.name).toBe("SerializedWorkflowAgentAdapter");
    });
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /studio/execute_sync", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

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
    });

    it("passes the pre-fetched workflow DSL through unchanged", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      // The adapter must not rewrite the user's workflow — only inject api_key.
      expect(callBody.payload.workflow.workflow_id).toBe("wf_1");
      expect(callBody.payload.workflow.nodes).toHaveLength(3);
      expect(callBody.payload.workflow.nodes[0].id).toBe("entry");
      expect(callBody.payload.workflow.nodes[1].id).toBe("greeter");
      expect(callBody.payload.workflow.nodes[2].id).toBe("end");
    });

    it("returns the end node output as a response string", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

      const result = await adapter.call(defaultInput);

      expect(result).toBe("Hi there!");
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.run_evaluations).toBe(false);
      expect(callBody.payload.do_not_trace).toBe(true);
    });

    it("generates a valid 32-char hex trace_id", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.trace_id).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("when no scenarioMappings are on the agent config", () => {
    it("falls back to legacy behavior: first input gets last user message, rest get empty string", async () => {
      const multiInputConfig: WorkflowAgentData = {
        ...defaultConfig,
        inputs: [
          { identifier: "query", type: "str" },
          { identifier: "context", type: "str" },
        ],
      };
      const adapter = new SerializedWorkflowAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["context"]).toBe("");
    });

    it("uses the last user message when multiple turns exist", async () => {
      const multiMessageInput: AgentInput = {
        ...defaultInput,
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" },
        ],
      };

      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(multiMessageInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.inputs[0]["input"]).toBe("Second message");
    });
  });

  describe("when scenarioMappings are on the agent config", () => {
    const multiInputConfig: WorkflowAgentData = {
      ...defaultConfig,
      inputs: [
        { identifier: "query", type: "str" },
        { identifier: "context", type: "str" },
      ],
      scenarioMappings: {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
        context: { type: "value", value: "Search the knowledge base" },
      },
    };

    it("uses resolved mappings for input record values", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["context"]).toBe("Search the knowledge base");
    });

    it("maps conversation history when the scenario source is messages", async () => {
      const config: WorkflowAgentData = {
        ...defaultConfig,
        inputs: [{ identifier: "history", type: "str" }],
        scenarioMappings: {
          history: {
            type: "source",
            sourceId: "scenario",
            path: ["messages"],
          },
        },
      };
      const adapter = new SerializedWorkflowAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["history"]).toBe(
        JSON.stringify(defaultInput.messages),
      );
    });

    it("ignores mappings for inputs that do not exist on the agent", async () => {
      const singleInputConfig: WorkflowAgentData = {
        ...defaultConfig,
        inputs: [{ identifier: "query", type: "str" }],
        scenarioMappings: {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
          deleted_field: { type: "value", value: "stale mapping" },
        },
      };
      const adapter = new SerializedWorkflowAgentAdapter(
        singleInputConfig,
        nlpServiceUrl,
        apiKey,
      );

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["deleted_field"]).toBeUndefined();
    });
  });

  describe("when scenarioOutputField is set", () => {
    it("extracts that specific field from result", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ answer: "42", output: "ignored" }),
      );
      const config: WorkflowAgentData = {
        ...defaultConfig,
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "output", type: "str" },
        ],
        scenarioOutputField: "answer",
      };

      const adapter = new SerializedWorkflowAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe("42");
    });

    it("stringifies a non-string value when the field is found", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ structured: { key: "value" } }),
      );
      const config: WorkflowAgentData = {
        ...defaultConfig,
        outputs: [{ identifier: "structured", type: "str" }],
        scenarioOutputField: "structured",
      };

      const adapter = new SerializedWorkflowAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe(JSON.stringify({ key: "value" }));
    });

    it("throws a descriptive error when the referenced field is missing", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ output: "some value" }));
      const config: WorkflowAgentData = {
        ...defaultConfig,
        scenarioOutputField: "missing_field",
      };

      const adapter = new SerializedWorkflowAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        'Scenario output field "missing_field" not found in agent output. Available fields: output',
      );
    });
  });

  describe("when the workflow execution fails", () => {
    it("extracts error detail from JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Workflow crashed" }),
        text: vi.fn().mockResolvedValue('{"detail": "Workflow crashed"}'),
      });

      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Workflow execution failed: HTTP 500 - Workflow crashed",
      );
    });

    it("falls back to text when JSON parsing fails", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("not json")),
        text: vi.fn().mockResolvedValue("Bad Gateway"),
      });

      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Workflow execution failed: HTTP 502 - Bad Gateway",
      );
    });
  });

  describe("when the NLP service returns a null result", () => {
    it("returns an empty string", async () => {
      mockFetch.mockResolvedValue(nlpResponse(null));

      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe("");
    });
  });

  describe("when sending the request to the NLP service", () => {
    it("passes an abort signal for timeout protection", async () => {
      const adapter = new SerializedWorkflowAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
