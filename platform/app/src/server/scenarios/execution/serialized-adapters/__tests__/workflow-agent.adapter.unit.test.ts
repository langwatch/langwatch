/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowAgentData } from "../../types";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import { SerializedWorkflowAgentAdapter } from "../workflow-agent.adapter";

const mockInjectTraceContextHeaders = vi.mocked(injectTraceContextHeaders);

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
    secrets: {},
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
    // clearAllMocks keeps implementations, so pin the no-active-context
    // default here; tests that need a trace context override it themselves.
    mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
      headers,
      traceId: undefined,
    }));
    mockFetch.mockResolvedValue(nlpResponse({ output: "Hi there!" }));
  });

  describe("basic contract", () => {
    it("has AGENT role", () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      expect(adapter.role).toBe(AgentRole.AGENT);
    });

    it("has correct name", () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      expect(adapter.name).toBe("SerializedWorkflowAgentAdapter");
    });
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /go/studio/execute_sync", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      expect(mockFetch).toHaveBeenCalledWith(
        `${nlpServiceUrl}/go/studio/execute_sync`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.type).toBe("execute_flow");
      expect(callBody.payload.workflow.api_key).toBe(apiKey);
    });

    describe("when the config has project secrets", () => {
      it("merges them into workflow.secrets so `secrets.NAME` resolves in code nodes", async () => {
        const adapter = new SerializedWorkflowAgentAdapter({
          config: {
            ...defaultConfig,
            secrets: {
              WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
              OTHER_SECRET: "value-2",
            },
          },
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await adapter.call(defaultInput);

        const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(callBody.payload.workflow.secrets).toEqual({
          WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
          OTHER_SECRET: "value-2",
        });
      });

      it("overrides pre-existing workflow.secrets values with the fresh prefetched ones", async () => {
        const adapter = new SerializedWorkflowAgentAdapter({
          config: {
            ...defaultConfig,
            workflow: {
              ...defaultDsl,
              secrets: {
                WORKFLOW_LANGWATCH_API_KEY: "sk-lw-stale",
                DSL_ONLY: "keep-me",
              },
            },
            secrets: {
              WORKFLOW_LANGWATCH_API_KEY: "sk-lw-fresh",
            },
          },
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await adapter.call(defaultInput);

        const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
        // Fresh prefetched value wins; unrelated DSL-only entries are kept.
        expect(callBody.payload.workflow.secrets).toEqual({
          WORKFLOW_LANGWATCH_API_KEY: "sk-lw-fresh",
          DSL_ONLY: "keep-me",
        });
      });
    });

    it("passes the pre-fetched workflow DSL through unchanged", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      const result = await adapter.call(defaultInput);

      expect(result).toBe("Hi there!");
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.run_evaluations).toBe(false);
      expect(callBody.payload.do_not_trace).toBe(true);
    });

    it("generates a valid 32-char hex trace_id", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
      const adapter = new SerializedWorkflowAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.context).toBe("");
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

      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(multiMessageInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.inputs[0].input).toBe("Second message");
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
      const adapter = new SerializedWorkflowAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.context).toBe("Search the knowledge base");
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
      const adapter = new SerializedWorkflowAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.history).toBe(JSON.stringify(defaultInput.messages));
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
      const adapter = new SerializedWorkflowAgentAdapter({
        config: singleInputConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.deleted_field).toBeUndefined();
    });
  });

  describe("when scenarioOutputField is set", () => {
    it("extracts that specific field from result", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ answer: "42", output: "ignored" }));
      const config: WorkflowAgentData = {
        ...defaultConfig,
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "output", type: "str" },
        ],
        scenarioOutputField: "answer",
      };

      const adapter = new SerializedWorkflowAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe("42");
    });

    it("stringifies a non-string value when the field is found", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ structured: { key: "value" } }));
      const config: WorkflowAgentData = {
        ...defaultConfig,
        outputs: [{ identifier: "structured", type: "str" }],
        scenarioOutputField: "structured",
      };

      const adapter = new SerializedWorkflowAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe(JSON.stringify({ key: "value" }));
    });

    it("throws a descriptive error when the referenced field is missing", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ output: "some value" }));
      const config: WorkflowAgentData = {
        ...defaultConfig,
        scenarioOutputField: "missing_field",
      };

      const adapter = new SerializedWorkflowAgentAdapter({
        config,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Workflow execution failed: HTTP 502 - Bad Gateway",
      );
    });
  });

  describe("when the NLP service returns a null result", () => {
    it("returns an empty string", async () => {
      mockFetch.mockResolvedValue(nlpResponse(null));

      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe("");
    });
  });

  describe("when sending the request to the NLP service", () => {
    it("passes an abort signal for timeout protection", async () => {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("given a run that resolved parameter values", () => {
    function callWithParameters(parameters: Record<string, string | number | boolean>) {
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
        parameters,
      });
      return adapter.call(defaultInput);
    }

    function sentPayload() {
      return JSON.parse(mockFetch.mock.calls[0]![1].body).payload;
    }

    /** @scenario "A workflow target receives params as entry inputs" */
    it("sends each one as an entry input", async () => {
      await callWithParameters({ region: "eu-central" });

      expect(sentPayload().inputs[0]).toMatchObject({ region: "eu-central" });
    });

    /** @scenario "A workflow target receives params as entry inputs" */
    it("sends an entry input as a string, whatever the value's type", async () => {
      await callWithParameters({ seats: 12, trial: false });

      expect(sentPayload().inputs[0]).toMatchObject({
        seats: "12",
        trial: "false",
      });
    });

    it("keeps the mapped conversation input alongside them", async () => {
      await callWithParameters({ region: "eu-central" });

      expect(sentPayload().inputs[0].input).toBe("Hello");
    });

    it("leaves a declared input alone when a parameter shares its name", async () => {
      // The workflow's own `input` carries the conversation turn. A parameter
      // that replaced it would leave the target answering the wrong question,
      // and the run would read as an agent that ignored the user.
      await callWithParameters({ input: "not the conversation" });

      expect(sentPayload().inputs[0].input).toBe("Hello");
    });

    /** @scenario "A code target reads params.NAME the same way it reads secrets.NAME" */
    it("carries them on the workflow with their native types, beside its secrets", async () => {
      await callWithParameters({ region: "eu-central", seats: 12 });

      expect(sentPayload().workflow.params).toEqual({
        region: "eu-central",
        seats: 12,
      });
      expect(sentPayload().workflow.secrets).toEqual({});
    });
  });

  describe("when a turn has an active trace context", () => {
    const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
    const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;

    const injectTraceContext = () => {
      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => {
        headers.traceparent = TRACEPARENT;
        return { headers, traceId: TRACE_ID };
      });
    };

    function sentPayload() {
      return JSON.parse(mockFetch.mock.calls[0]![1].body).payload;
    }

    /** @scenario "A workflow execution receives the trace context in its params" */
    it("carries params.trace_id and params.traceparent on the workflow", async () => {
      injectTraceContext();
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { region: "eu-central" },
      });

      await adapter.call(defaultInput);

      expect(sentPayload().workflow.params).toEqual({
        region: "eu-central",
        trace_id: TRACE_ID,
        traceparent: TRACEPARENT,
      });
    });

    /** @scenario "The trace context wins over a run parameter with the same name" */
    it("overrides a run parameter named trace_id or traceparent", async () => {
      injectTraceContext();
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { trace_id: "supplied", traceparent: "supplied" },
      });

      await adapter.call(defaultInput);

      expect(sentPayload().workflow.params).toEqual({
        trace_id: TRACE_ID,
        traceparent: TRACEPARENT,
      });
    });

    /** @scenario "A workflow execution receives the trace context in its params" */
    it("keeps the trace context out of the entry inputs", async () => {
      injectTraceContext();
      const adapter = new SerializedWorkflowAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { region: "eu-central" },
      });

      await adapter.call(defaultInput);

      const entryInputs = sentPayload().inputs[0];
      expect(entryInputs.trace_id).toBeUndefined();
      expect(entryInputs.traceparent).toBeUndefined();
      expect(entryInputs.region).toBe("eu-central");
    });
  });
});
