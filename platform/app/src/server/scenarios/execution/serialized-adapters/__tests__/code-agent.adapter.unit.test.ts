/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAgentData } from "../../types";

// Capture withActiveSpan calls so the timeout/error paths can be verified.
// (lw#3438: traced failures must always leave a span footprint.)
const { withActiveSpanCalls } = vi.hoisted(() => {
  const withActiveSpanCalls: Array<{
    name: string;
    options: { kind: number; attributes: Record<string, unknown> };
    span: {
      setAttribute: ReturnType<typeof vi.fn>;
      setAttributes: ReturnType<typeof vi.fn>;
      setStatus: ReturnType<typeof vi.fn>;
      recordException: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  }> = [];
  return { withActiveSpanCalls };
});

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async (
      name: string,
      opts: { kind: number; attributes: Record<string, unknown> },
      fn: (span: {
        setAttribute: ReturnType<typeof vi.fn>;
        setAttributes: ReturnType<typeof vi.fn>;
        setStatus: ReturnType<typeof vi.fn>;
        recordException: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      }) => unknown,
    ) => {
      const span = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
      };
      withActiveSpanCalls.push({ name, options: opts, span });
      try {
        return await fn(span);
      } catch (err) {
        span.setStatus({ code: 2, message: (err as Error)?.message });
        span.recordException(err as Error);
        span.end();
        throw err;
      }
    },
  }),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import {
  SerializedCodeAgentAdapter,
  SerializedCodeAgentAdapterError,
} from "../code-agent.adapter";

const mockInjectTraceContextHeaders = vi.mocked(injectTraceContextHeaders);

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
    status: 200,
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
    withActiveSpanCalls.length = 0;
    // Pin the timeout explicitly so the test doesn't rely on ambient env
    process.env.NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS = "600";
    // clearAllMocks keeps implementations, so pin the no-active-context
    // default here; tests that need a trace context override it themselves.
    mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
      headers,
      traceId: undefined,
    }));
    mockFetch.mockResolvedValue(nlpResponse({ output: "processed: Hello" }));
  });

  it("has AGENT role", () => {
    const adapter = new SerializedCodeAgentAdapter({
      config: defaultConfig,
      nlpServiceUrl: nlpServiceUrl,
      projectApiKey: apiKey,
    });
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedCodeAgentAdapter({
      config: defaultConfig,
      nlpServiceUrl: nlpServiceUrl,
      projectApiKey: apiKey,
    });
    expect(adapter.name).toBe("SerializedCodeAgentAdapter");
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /go/studio/execute_sync", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
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
      expect(callBody.payload.workflow.template_adapter).toBe("default");
    });

    describe("when the config has project secrets", () => {
      it("includes them on the synthesized workflow DSL so `secrets.NAME` resolves", async () => {
        const adapter = new SerializedCodeAgentAdapter({
          config: {
            ...defaultConfig,
            secrets: {
              WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
              OTHER_SECRET: "value-2",
            },
          },
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await adapter.call(defaultInput);

        const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(callBody.payload.workflow.secrets).toEqual({
          WORKFLOW_LANGWATCH_API_KEY: "sk-lw-test",
          OTHER_SECRET: "value-2",
        });
      });
    });

    it("builds a workflow with entry, code, and end nodes", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

      const adapter = new SerializedCodeAgentAdapter({
        config: configNoIO,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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
      mockFetch.mockResolvedValue(nlpResponse({ output: "nested result" }));

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe("nested result");
    });

    it("returns empty string when result is null", async () => {
      mockFetch.mockResolvedValue(nlpResponse(null));

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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

      const adapter = new SerializedCodeAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.run_evaluations).toBe(false);
      expect(callBody.payload.do_not_trace).toBe(true);
    });

    it("generates a valid 32-char hex trace_id", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
      const adapter = new SerializedCodeAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.context).toBe("Search the knowledge base");
    });

    it("uses resolved mappings for workflow node input values", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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
      const adapter = new SerializedCodeAgentAdapter({
        config: singleInputConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.deleted_field).toBeUndefined();
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
      const adapter = new SerializedCodeAgentAdapter({
        config: multiInputConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.context).toBe("");
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

      const adapter = new SerializedCodeAgentAdapter({
        config: config,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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

      const adapter = new SerializedCodeAgentAdapter({
        config: config,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe(JSON.stringify({ key: "value" }));
    });

    it("throws a descriptive error when the referenced field is missing", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ output: "some value" }));
      const config: CodeAgentData = {
        ...defaultConfig,
        scenarioOutputField: "missing_field",
      };

      const adapter = new SerializedCodeAgentAdapter({
        config: config,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        'Scenario output field "missing_field" not found in agent output. Available fields: output',
      );
    });
  });

  describe("when scenarioOutputField is not set and agent has one output", () => {
    it("uses that output (default behavior)", async () => {
      mockFetch.mockResolvedValue(nlpResponse({ output: "single result" }));

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      const result = await adapter.call(defaultInput);

      expect(result).toBe("single result");
    });
  });

  describe("when building the workflow", () => {
    it("includes a valid dataset on the entry node", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
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
   * Span emission on success and on failure paths.
   *
   * Regression for lw#3438 — customer trace had no adapter span on a hung
   * NLP request, making the failure invisible.
   */
  describe("when emitting spans for the NLP request (lw#3438)", () => {
    const findExecuteSpan = () =>
      withActiveSpanCalls.find(
        (c) => c.name === "SerializedCodeAgentAdapter.execute_nlp_request",
      );

    describe("when the request succeeds", () => {
      /** @scenario code-agent adapter emits a span tagged with the request URL on success */
      it("emits a CLIENT span tagged with the agent id and HTTP url", async () => {
        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });
        await adapter.call(defaultInput);

        const span = findExecuteSpan();
        expect(span).toBeDefined();
        expect(span!.options.attributes["scenario.agent.id"]).toBe("agent_123");
        expect(span!.options.attributes["http.url"]).toBe(
          `${nlpServiceUrl}/go/studio/execute_sync`,
        );
        expect(span!.options.attributes["http.method"]).toBe("POST");
      });

      it("annotates the span with the response status code", async () => {
        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });
        await adapter.call(defaultInput);

        const span = findExecuteSpan();
        const setAttrCalls = span!.span.setAttribute.mock.calls;
        const httpStatusCall = setAttrCalls.find(
          (c) => c[0] === "http.status_code",
        );
        expect(httpStatusCall?.[1]).toBe(200);
      });
    });

    describe("when the NLP service times out before responding", () => {
      // Fetch implementation that rejects with AbortError as soon as the
      // controller's signal aborts. Returning the promise via async/await
      // keeps the rejection attached to the awaited chain, avoiding spurious
      // "unhandled rejection" warnings when fake timers drive the abort.
      const abortAwareFetch = (signal: AbortSignal) =>
        new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
            return;
          }
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          };
          signal.addEventListener("abort", onAbort);
        });

      /** @scenario code-agent adapter emits an error span with kind=timeout when the NLP service hangs */
      it("throws SerializedCodeAgentAdapterError with kind=timeout and emits an error span", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) =>
            abortAwareFetch(opts.signal),
        );
        vi.useFakeTimers();
        try {
          const adapter = new SerializedCodeAgentAdapter({
            config: defaultConfig,
            nlpServiceUrl: nlpServiceUrl,
            projectApiKey: apiKey,
          });
          const callPromise = adapter.call(defaultInput);
          // Attach the rejection handler before advancing timers so the
          // synchronous abort doesn't surface as an unhandled rejection.
          const settled = expect(callPromise).rejects.toBeInstanceOf(
            SerializedCodeAgentAdapterError,
          );
          await vi.advanceTimersByTimeAsync(630_001);
          await settled;
        } finally {
          vi.useRealTimers();
        }

        const span = findExecuteSpan();
        expect(span).toBeDefined();
        const setAttrCalls = span!.span.setAttribute.mock.calls;
        const errorKindCall = setAttrCalls.find((c) => c[0] === "error.kind");
        expect(errorKindCall?.[1]).toBe("timeout");
        expect(span!.span.recordException).toHaveBeenCalled();
      });

      it("the thrown error reports kind=timeout for diagnosis", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) =>
            abortAwareFetch(opts.signal),
        );
        vi.useFakeTimers();
        let captured: SerializedCodeAgentAdapterError | undefined;
        try {
          const adapter = new SerializedCodeAgentAdapter({
            config: defaultConfig,
            nlpServiceUrl: nlpServiceUrl,
            projectApiKey: apiKey,
          });
          const callPromise = adapter
            .call(defaultInput)
            .catch((e: SerializedCodeAgentAdapterError) => {
              captured = e;
            });
          await vi.advanceTimersByTimeAsync(630_001);
          await callPromise;
        } finally {
          vi.useRealTimers();
        }
        expect(captured?.kind).toBe("timeout");
        expect(captured?.message).toContain("did not respond within 630000ms");
      });
    });

    describe("when fetch fails before the response is received", () => {
      /** @scenario code-agent adapter emits an error span with kind=fetch when the network fails */
      it("emits an error span with kind=fetch", async () => {
        mockFetch.mockRejectedValue(new TypeError("fetch failed"));

        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });
        await expect(adapter.call(defaultInput)).rejects.toBeInstanceOf(
          SerializedCodeAgentAdapterError,
        );

        const span = findExecuteSpan();
        const setAttrCalls = span!.span.setAttribute.mock.calls;
        const errorKindCall = setAttrCalls.find((c) => c[0] === "error.kind");
        expect(errorKindCall?.[1]).toBe("fetch");
        expect(span!.span.recordException).toHaveBeenCalled();
      });
    });

    describe("when the NLP service returns a non-2xx response", () => {
      /** @scenario code-agent adapter emits an error span with kind=http when the NLP service returns non-2xx */
      it("emits an error span with kind=http and the status code", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 503,
          json: vi.fn().mockResolvedValue({ detail: "service down" }),
          text: vi.fn().mockResolvedValue('{"detail": "service down"}'),
        });

        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });
        await expect(adapter.call(defaultInput)).rejects.toBeInstanceOf(
          SerializedCodeAgentAdapterError,
        );

        const span = findExecuteSpan();
        const setAttrCalls = span!.span.setAttribute.mock.calls;
        const errorKindCall = setAttrCalls.find((c) => c[0] === "error.kind");
        const httpStatusCall = setAttrCalls.find(
          (c) => c[0] === "http.status_code",
        );
        expect(errorKindCall?.[1]).toBe("http");
        expect(httpStatusCall?.[1]).toBe(503);
      });

      it("the thrown error carries the http status code", async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          json: vi.fn().mockResolvedValue({ detail: "boom" }),
          text: vi.fn().mockResolvedValue('{"detail": "boom"}'),
        });

        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl: nlpServiceUrl,
          projectApiKey: apiKey,
        });
        let captured: SerializedCodeAgentAdapterError | undefined;
        try {
          await adapter.call(defaultInput);
        } catch (e) {
          captured = e as SerializedCodeAgentAdapterError;
        }
        expect(captured?.kind).toBe("http");
        expect(captured?.httpStatus).toBe(500);
      });
    });
  });

  describe("when the run resolved parameter values", () => {
    /** @scenario "A code target reads params.NAME the same way it reads secrets.NAME" */
    it("carries them on the synthesized workflow DSL beside its secrets", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, secrets: { API_KEY: "sk-test" } },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { region: "eu-central" },
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.workflow.params).toEqual({
        region: "eu-central",
      });
      expect(callBody.payload.workflow.secrets).toEqual({ API_KEY: "sk-test" });
    });

    /** @scenario "A code target reads params.NAME the same way it reads secrets.NAME" */
    it("keeps each value's native type", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { seats: 12, trial: false, region: "eu-central" },
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.workflow.params).toEqual({
        seats: 12,
        trial: false,
        region: "eu-central",
      });
    });

    it("sends an empty namespace when the run resolved none", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.payload.workflow.params).toEqual({});
    });
  });

  describe("when a turn has an active trace context", () => {
    const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
    const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;

    const injectTraceContext = ({
      traceId,
      traceparent,
    }: {
      traceId: string;
      traceparent: string;
    }) => {
      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => {
        headers.traceparent = traceparent;
        return { headers, traceId };
      });
    };

    const sentParams = (call = 0) =>
      JSON.parse(mockFetch.mock.calls[call]![1].body).payload.workflow.params;

    /** @scenario "A code execution receives the trace context in its params" */
    it("carries params.trace_id and params.traceparent on the workflow", async () => {
      injectTraceContext({ traceId: TRACE_ID, traceparent: TRACEPARENT });
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { region: "eu-central" },
      });

      await adapter.call(defaultInput);

      expect(sentParams()).toEqual({
        region: "eu-central",
        trace_id: TRACE_ID,
        traceparent: TRACEPARENT,
      });
    });

    /** @scenario "The trace context wins over a run parameter with the same name" */
    it("overrides a run parameter named trace_id or traceparent", async () => {
      injectTraceContext({ traceId: TRACE_ID, traceparent: TRACEPARENT });
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
        parameters: { trace_id: "supplied", traceparent: "supplied" },
      });

      await adapter.call(defaultInput);

      expect(sentParams()).toEqual({
        trace_id: TRACE_ID,
        traceparent: TRACEPARENT,
      });
    });

    /** @scenario "A code execution receives the trace context in its params" */
    it("captures a fresh context on every turn", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      injectTraceContext({ traceId: TRACE_ID, traceparent: TRACEPARENT });
      await adapter.call(defaultInput);

      const secondTraceId = "1bf7651916cd43dd8448eb211c80319d";
      const secondTraceparent = `00-${secondTraceId}-b7ad6b7169203331-01`;
      injectTraceContext({
        traceId: secondTraceId,
        traceparent: secondTraceparent,
      });
      await adapter.call(defaultInput);

      expect(sentParams(0).trace_id).toBe(TRACE_ID);
      expect(sentParams(1).trace_id).toBe(secondTraceId);
      expect(sentParams(1).traceparent).toBe(secondTraceparent);
    });
  });
  describe("when the agent config carries a per-agent code timeout", () => {
    /** The code node's parameters, as sent on the synthesized workflow DSL. */
    const codeNodeParameters = (): {
      identifier: string;
      type: string;
      value: unknown;
    }[] => {
      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      return codeNode.data.parameters;
    };

    it("sends it as the code node's timeout_ms parameter", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, timeoutMs: 5000 },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      expect(codeNodeParameters()).toContainEqual({
        identifier: "timeout_ms",
        type: "int",
        value: 5000,
      });
    });

    it("still sends the code parameter", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, timeoutMs: 5000 },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      expect(codeNodeParameters()).toContainEqual({
        identifier: "code",
        type: "code",
        value: defaultConfig.code,
      });
    });

    it("keeps its own fetch deadline above the requested code budget", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, timeoutMs: 300_000 },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const spanAttributes = withActiveSpanCalls[0]!.options.attributes;
      expect(spanAttributes["nlp.timeout_ms"] as number).toBeGreaterThan(
        300_000,
      );
    });

    it("clamps its own fetch deadline to the platform's maximum for one turn", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, timeoutMs: Number.MAX_SAFE_INTEGER },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      // The engine ceiling bounds the agent's Python, not this HTTP request.
      // Without a maximum here an absurd config parks a worker on a socket
      // for as long as the number says — up to ~24.9 days.
      const spanAttributes = withActiveSpanCalls[0]!.options.attributes;
      expect(spanAttributes["nlp.timeout_ms"]).toBe(900_000);
    });

    it("clamps a budget only just past the platform's maximum", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        // 890s + the 30s headroom lands at 920s, above the 900s maximum.
        config: { ...defaultConfig, timeoutMs: 890_000 },
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      const spanAttributes = withActiveSpanCalls[0]!.options.attributes;
      expect(spanAttributes["nlp.timeout_ms"]).toBe(900_000);
    });

    it("omits timeout_ms when the config carries no timeout", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await adapter.call(defaultInput);

      expect(
        codeNodeParameters().some((p) => p.identifier === "timeout_ms"),
      ).toBe(false);
    });
  });

  describe("when the operator configures the platform's fetch ceiling", () => {
    /** The fetch deadline this adapter armed, as reported on the span. */
    const armedFetchTimeoutMs = (): unknown =>
      withActiveSpanCalls[0]!.options.attributes["nlp.timeout_ms"];

    /** A code budget large enough that only the ceiling can decide the result. */
    const hugeBudget = { ...defaultConfig, timeoutMs: Number.MAX_SAFE_INTEGER };

    const callWith = async (config: CodeAgentData) => {
      const adapter = new SerializedCodeAgentAdapter({
        config,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("falls back to 15 minutes when NLP_FETCH_MAX_TIMEOUT_MS is unset", async () => {
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", undefined);

      await callWith(hugeBudget);

      expect(armedFetchTimeoutMs()).toBe(900_000);
    });

    it("honors a raised ceiling so the engine still gets to report its own timeout", async () => {
      // An operator who raises NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS past
      // 900s must be able to raise this one too, or the platform aborts the
      // fetch first and the caller sees a generic fetch-side timeout instead
      // of the engine's diagnosis.
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "1800000");

      await callWith(hugeBudget);

      expect(armedFetchTimeoutMs()).toBe(1_800_000);
    });

    it("honors a lowered ceiling", async () => {
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "300000");

      await callWith(hugeBudget);

      expect(armedFetchTimeoutMs()).toBe(300_000);
    });

    it.each([
      ["an empty value", ""],
      ["a non-numeric value", "banana"],
      ["a zero", "0"],
      ["a negative value", "-5000"],
      ["a whitespace-only value", "   "],
      ["an infinite value", "Infinity"],
    ])("falls back to 15 minutes on %s", async (_label, raw) => {
      // Clamp, never reject: the same contract the engine keeps for its own
      // knobs. A nonsensical ceiling must not fail the scenario run.
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", raw);

      await callWith(hugeBudget);

      expect(armedFetchTimeoutMs()).toBe(900_000);
    });

    it("clamps a large code budget down to the configured ceiling", async () => {
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "200000");

      // 300s + the 30s headroom would be 330s, above the 200s ceiling.
      await callWith({ ...defaultConfig, timeoutMs: 300_000 });

      expect(armedFetchTimeoutMs()).toBe(200_000);
    });

    it("bounds the default deadline too when set below the floor", async () => {
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "45000");

      await callWith(defaultConfig);

      expect(armedFetchTimeoutMs()).toBe(45_000);
    });

    it("leaves the default deadline at the engine ceiling + headroom (630s) under the default max", async () => {
      await callWith(defaultConfig);

      expect(armedFetchTimeoutMs()).toBe(630_000);
    });

    it("is read per call, so a change between turns takes effect", async () => {
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "300000");
      await callWith(hugeBudget);
      expect(armedFetchTimeoutMs()).toBe(300_000);

      withActiveSpanCalls.length = 0;
      vi.stubEnv("NLP_FETCH_MAX_TIMEOUT_MS", "600000");
      await callWith(hugeBudget);
      expect(armedFetchTimeoutMs()).toBe(600_000);
    });
  });
});
