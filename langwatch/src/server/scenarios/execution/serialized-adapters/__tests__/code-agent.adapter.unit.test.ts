/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAgentData } from "../../types";
import {
  SerializedCodeAgentAdapter,
  SerializedCodeAgentAdapterError,
} from "../code-agent.adapter";

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
    secrets: {},
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

    describe("when the config has project secrets", () => {
      it("includes them on the synthesized workflow DSL so `secrets.NAME` resolves", async () => {
        const adapter = new SerializedCodeAgentAdapter(
          {
            ...defaultConfig,
            secrets: {
              WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
              OTHER_SECRET: "value-2",
            },
          },
          nlpServiceUrl,
          apiKey,
        );

        await adapter.call(defaultInput);

        const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(callBody.payload.workflow.secrets).toEqual({
          WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
          OTHER_SECRET: "value-2",
        });
      });
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
    it("extracts user code error detail from a 500 JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: "Python runtime error" }),
        text: vi.fn().mockResolvedValue('{"detail": "Python runtime error"}'),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        /user code raised an error[\s\S]+Python runtime error/,
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
        /NLP service returned HTTP 502[\s\S]+Bad Gateway/,
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

  describe("when scenarioMappings are on the agent config", () => {
    const multiInputConfig: CodeAgentData = {
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

    /** @scenario Code agent adapter uses resolved fieldMappings for input assignment */
    it("uses resolved mappings for input assignment in the input record", async () => {
      const adapter = new SerializedCodeAgentAdapter(multiInputConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["context"]).toBe("Search the knowledge base");
    });

    it("uses resolved mappings for workflow node input values", async () => {
      const adapter = new SerializedCodeAgentAdapter(multiInputConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].value).toBe("Hello");
      expect(codeNode.data.inputs[1].value).toBe("Search the knowledge base");
    });

    /** @scenario Code agent adapter ignores mappings for nonexistent inputs */
    it("ignores mappings for inputs that do not exist on the agent", async () => {
      const singleInputConfig: CodeAgentData = {
        ...defaultConfig,
        inputs: [{ identifier: "query", type: "str" }],
        scenarioMappings: {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
          deleted_field: { type: "value", value: "stale mapping" },
        },
      };
      const adapter = new SerializedCodeAgentAdapter(singleInputConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["deleted_field"]).toBeUndefined();
    });
  });

  describe("when no scenarioMappings are on the agent config", () => {
    /** @scenario Code agent adapter falls back to legacy behavior without mappings */
    /** @scenario Adapters use legacy behavior when fieldMappings is undefined */
    it("falls back to legacy behavior: first input gets last user message, rest get empty string", async () => {
      const multiInputConfig: CodeAgentData = {
        ...defaultConfig,
        inputs: [
          { identifier: "query", type: "str" },
          { identifier: "context", type: "str" },
        ],
      };
      const adapter = new SerializedCodeAgentAdapter(multiInputConfig, nlpServiceUrl, apiKey);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord["query"]).toBe("Hello");
      expect(inputsRecord["context"]).toBe("");
    });
  });

  describe("when scenarioOutputField is set", () => {
    it("extracts that specific field from result", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ answer: "42", output: "ignored" }),
      );
      const config: CodeAgentData = {
        ...defaultConfig,
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "output", type: "str" },
        ],
        scenarioOutputField: "answer",
      };

      const adapter = new SerializedCodeAgentAdapter(config, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("42");
    });

    it("stringifies a non-string value when the field is found", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ structured: { key: "value" } }),
      );
      const config: CodeAgentData = {
        ...defaultConfig,
        outputs: [{ identifier: "structured", type: "str" }],
        scenarioOutputField: "structured",
      };

      const adapter = new SerializedCodeAgentAdapter(config, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe(JSON.stringify({ key: "value" }));
    });

    it("throws a descriptive error when the referenced field is missing", async () => {
      mockFetch.mockResolvedValue(
        nlpResponse({ output: "some value" }),
      );
      const config: CodeAgentData = {
        ...defaultConfig,
        scenarioOutputField: "missing_field",
      };

      const adapter = new SerializedCodeAgentAdapter(config, nlpServiceUrl, apiKey);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        'Scenario output field "missing_field" not found in agent output. Available fields: output',
      );
    });
  });

  describe("when scenarioOutputField is not set and agent has one output", () => {
    it("uses that output (default behavior)", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ output: "single result" }));

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("single result");
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

  /**
   * Structured error surfacing for the worker log (lw#3439).
   *
   * The previous error format collapsed the response body, AI SDK warnings,
   * and OTEL flush messages into one string, making customer triage hard.
   * The adapter now throws SerializedCodeAgentAdapterError with structured
   * fields and a multi-line message that distinguishes user-code failures
   * from infra failures.
   */
  describe("when surfacing errors from the NLP service (lw#3439)", () => {
    /** @scenario adapter labels HTTP 500 with detail as a user-code failure */
    it("labels HTTP 500 with a detail payload as a user-code failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          detail:
            'Traceback (most recent call last):\n  File "user.py", line 4, in execute\n    raise httpx.TimeoutException("The read operation timed out")\nhttpx.TimeoutException: The read operation timed out',
        }),
        text: vi.fn().mockResolvedValue(""),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }

      expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
      expect(captured!.source).toBe("user_code");
      expect(captured!.httpStatus).toBe(500);
      expect(captured!.endpoint).toBe(`${nlpServiceUrl}/studio/execute_sync`);
      expect(captured!.message).toMatch(/user code raised an error/);
      expect(captured!.message).toMatch(/endpoint: POST http:\/\/localhost:8080\/studio\/execute_sync/);
      expect(captured!.message).toMatch(/status: 500/);
      expect(captured!.message).toMatch(/httpx\.TimeoutException/);
    });

    /** @scenario adapter labels non-500 status as an NLP service failure */
    it("labels other non-2xx statuses as an infra (NLP service) failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({ detail: "service down" }),
        text: vi.fn().mockResolvedValue('{"detail": "service down"}'),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }
      expect(captured!.source).toBe("nlp_service");
      expect(captured!.httpStatus).toBe(503);
      expect(captured!.message).toMatch(/NLP service returned HTTP 503/);
      expect(captured!.message).toMatch(/service down/);
    });

    /** @scenario adapter strips AI SDK warnings and OTEL noise from the surfaced message */
    it("strips AI SDK warnings and OTEL flush chatter from the rendered message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          detail: [
            'AI SDK Warning (openai.chat / openai/gpt-5.2): The feature "specificationVersion" is used in a compatibility mode.',
            "Flushing OTEL traces...",
            "OTEL traces flushed",
            "",
            "ValueError: Bad input",
          ].join("\n"),
        }),
        text: vi.fn().mockResolvedValue(""),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }
      expect(captured!.message).not.toMatch(/AI SDK Warning/);
      expect(captured!.message).not.toMatch(/Flushing OTEL traces/);
      expect(captured!.message).not.toMatch(/OTEL traces flushed/);
      expect(captured!.message).toMatch(/ValueError: Bad input/);
      // raw blob is preserved for deep debugging
      expect(captured!.rawDetail).toMatch(/AI SDK Warning/);
      expect(captured!.rawDetail).toMatch(/ValueError: Bad input/);
    });

    /** @scenario adapter truncates long error bodies but preserves them on rawDetail */
    it("truncates very long error bodies but preserves the original on rawDetail", async () => {
      const huge = "x".repeat(10_000);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: huge }),
        text: vi.fn().mockResolvedValue(""),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }
      expect(captured!.message).toMatch(/truncated, original was 10000 chars/);
      expect(captured!.message.length).toBeLessThan(huge.length);
      expect(captured!.rawDetail).toBe(huge);
    });

    /** @scenario adapter labels a fetch failure as a network error */
    it("labels a fetch-time failure as a network error", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }
      expect(captured!.source).toBe("network");
      expect(captured!.message).toMatch(/failed to reach NLP service/);
      expect(captured!.message).toMatch(/fetch failed/);
    });

    /** @scenario adapter labels an aborted fetch as a timeout */
    it("labels an aborted fetch (timeout) with source=timeout", async () => {
      const abortAware = (signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          };
          signal.addEventListener("abort", onAbort);
        });
      mockFetch.mockImplementation(async (_url: string, opts: { signal: AbortSignal }) =>
        abortAware(opts.signal),
      );

      vi.useFakeTimers();
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl, apiKey);
        const callPromise = adapter.call(defaultInput).catch((e: SerializedCodeAgentAdapterError) => {
          captured = e;
        });
        await vi.advanceTimersByTimeAsync(120_001);
        await callPromise;
      } finally {
        vi.useRealTimers();
      }
      expect(captured!.source).toBe("timeout");
      expect(captured!.message).toMatch(/did not respond within 120000ms/);
    });
  });
});
