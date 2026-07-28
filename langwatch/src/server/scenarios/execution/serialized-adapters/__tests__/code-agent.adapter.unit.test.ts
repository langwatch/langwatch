/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAgentData } from "../../types";
import recordedNlpgoResponses from "./fixtures/nlpgo-recorded-responses.json";

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

  /**
   * Every double below is a REAL `Response`.
   *
   * A plain `{ ok, status, json, text }` object literal has independently
   * callable, infinitely re-readable `json`/`text`, so it cannot reproduce
   * body-stream semantics — that is precisely what let a `json()`-then-`text()`
   * fallback ship green while dropping every non-JSON body in production, and
   * what let the fixtures encode a `{ detail }` contract the Go engine never
   * serves (review lw#3439). Built with the constructor, both come for free.
   */
  const jsonResponse = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  /** A successful /go/studio/execute_sync run (services/nlpgo/app/app.go:121). */
  const nlpResponse = (result: Record<string, unknown> | null) =>
    jsonResponse({ trace_id: "trace_abc123", status: "success", result }, 200);

  /**
   * A 200 whose run the engine finalized as FAILED — the shape a user's
   * Python exception actually arrives in. Asserted against the live engine in
   * `services/nlpgo/tests/integration/code_block_spec_test.go`, which requires
   * HTTP 200 and reads `status: "error"` + `error.type` = the exception class.
   */
  const engineFailureResponse = (error: {
    node_id?: string;
    type: string;
    message: string;
    traceback?: string;
  }) => jsonResponse({ trace_id: "trace_abc123", status: "error", error }, 200);

  /**
   * The herr envelope the Go engine writes for a rejected request
   * (`pkg/herr/http.go:30-74`). Statuses come from `registerErrorStatuses` in
   * `services/nlpgo/adapters/httpapi/router.go`.
   */
  const herrResponse = (args: {
    status: number;
    type: string;
    message?: string;
    meta?: Record<string, unknown>;
  }) =>
    jsonResponse(
      {
        error: {
          type: args.type,
          message: args.message ?? args.type,
          ...(args.meta ? { meta: args.meta } : {}),
        },
      },
      args.status,
    );

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,

    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  // Fetch implementation that rejects with AbortError as soon as the
  // controller's signal aborts. Returning the promise via async/await keeps
  // the rejection attached to the awaited chain, avoiding spurious
  // "unhandled rejection" warnings when fake timers drive the abort. Shared
  // across the timeout describe blocks (lw#3438 + lw#3439).
  const abortAwareFetch = (signal: AbortSignal) =>
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

  beforeEach(() => {
    vi.clearAllMocks();
    withActiveSpanCalls.length = 0;
    // mockImplementation, not mockResolvedValue: a real Response body can be
    // read only once, so each fetch needs its own instance.
    mockFetch.mockImplementation(async () =>
      nlpResponse({ output: "processed: Hello" }),
    );
  });

  it("has AGENT role", () => {
    const adapter = new SerializedCodeAgentAdapter(
      defaultConfig,
      nlpServiceUrl,
      apiKey,
    );
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedCodeAgentAdapter(
      defaultConfig,
      nlpServiceUrl,
      apiKey,
    );
    expect(adapter.name).toBe("SerializedCodeAgentAdapter");
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("sends an execute_flow event to /go/studio/execute_sync", async () => {
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

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
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

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
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

      const result = await adapter.call(defaultInput);

      expect(result).toBe("processed: Hello");
    });
  });

  describe("when the code execution fails", () => {
    it("extracts user code error detail from a legacy 500 JSON response", async () => {
      mockFetch.mockImplementation(async () =>
        jsonResponse({ detail: "Python runtime error" }, 500),
      );

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        /user code raised an error[\s\S]+Python runtime error/,
      );
    });

    it("preserves a non-JSON error body on the surfaced message", async () => {
      mockFetch.mockImplementation(
        async () => new Response("Bad Gateway", { status: 502 }),
      );

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );

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

      const adapter = new SerializedCodeAgentAdapter(
        configNoIO,
        nlpServiceUrl,
        apiKey,
      );

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
      mockFetch.mockImplementation(async () =>
        nlpResponse({ output: "nested result" }),
      );

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe("nested result");
    });

    it("returns empty string when result is null", async () => {
      mockFetch.mockImplementation(async () => nlpResponse(null));

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
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

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
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

      const adapter = new SerializedCodeAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );
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
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it("sets run_evaluations to false and do_not_trace to true", async () => {
      const adapter = new SerializedCodeAgentAdapter(
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
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
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
      const adapter = new SerializedCodeAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const inputsRecord = callBody.payload.inputs[0];
      expect(inputsRecord.query).toBe("Hello");
      expect(inputsRecord.context).toBe("Search the knowledge base");
    });

    it("uses resolved mappings for workflow node input values", async () => {
      const adapter = new SerializedCodeAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );

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
      const adapter = new SerializedCodeAgentAdapter(
        singleInputConfig,
        nlpServiceUrl,
        apiKey,
      );

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
      const adapter = new SerializedCodeAgentAdapter(
        multiInputConfig,
        nlpServiceUrl,
        apiKey,
      );

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

      const adapter = new SerializedCodeAgentAdapter(
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
      const config: CodeAgentData = {
        ...defaultConfig,
        outputs: [{ identifier: "structured", type: "str" }],
        scenarioOutputField: "structured",
      };

      const adapter = new SerializedCodeAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe(JSON.stringify({ key: "value" }));
    });

    it("throws a descriptive error when the referenced field is missing", async () => {
      mockFetch.mockImplementation(async () =>
        nlpResponse({ output: "some value" }),
      );
      const config: CodeAgentData = {
        ...defaultConfig,
        scenarioOutputField: "missing_field",
      };

      const adapter = new SerializedCodeAgentAdapter(
        config,
        nlpServiceUrl,
        apiKey,
      );

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        'Scenario output field "missing_field" not found in agent output. Available fields: output',
      );
    });
  });

  describe("when scenarioOutputField is not set and agent has one output", () => {
    it("uses that output (default behavior)", async () => {
      mockFetch.mockImplementation(async () =>
        nlpResponse({ output: "single result" }),
      );

      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      const result = await adapter.call(defaultInput);

      expect(result).toBe("single result");
    });
  });

  describe("when building the workflow", () => {
    it("includes a valid dataset on the entry node", async () => {
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
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
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
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
        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );
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
        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );
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
      /** @scenario code-agent adapter emits an error span with kind=timeout when the NLP service hangs */
      it("throws SerializedCodeAgentAdapterError with kind=timeout and emits an error span", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) =>
            abortAwareFetch(opts.signal),
        );
        vi.useFakeTimers();
        try {
          const adapter = new SerializedCodeAgentAdapter(
            defaultConfig,
            nlpServiceUrl,
            apiKey,
          );
          const callPromise = adapter.call(defaultInput);
          // Attach the rejection handler before advancing timers so the
          // synchronous abort doesn't surface as an unhandled rejection.
          const settled = expect(callPromise).rejects.toBeInstanceOf(
            SerializedCodeAgentAdapterError,
          );
          await vi.advanceTimersByTimeAsync(120_001);
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
          const adapter = new SerializedCodeAgentAdapter(
            defaultConfig,
            nlpServiceUrl,
            apiKey,
          );
          const callPromise = adapter
            .call(defaultInput)
            .catch((e: SerializedCodeAgentAdapterError) => {
              captured = e;
            });
          await vi.advanceTimersByTimeAsync(120_001);
          await callPromise;
        } finally {
          vi.useRealTimers();
        }
        expect(captured?.kind).toBe("timeout");
        expect(captured?.message).toContain("did not respond within 120000ms");
      });
    });

    describe("when fetch fails before the response is received", () => {
      /** @scenario code-agent adapter emits an error span with kind=fetch when the network fails */
      it("emits an error span with kind=fetch", async () => {
        mockFetch.mockRejectedValue(new TypeError("fetch failed"));

        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );
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
        mockFetch.mockImplementation(async () =>
          herrResponse({
            status: 503,
            type: "child_unavailable",
            message: "service down",
          }),
        );

        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );
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
        mockFetch.mockImplementation(async () =>
          herrResponse({
            status: 500,
            type: "internal_error",
            message: "boom",
          }),
        );

        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );
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

  /**
   * Structured error surfacing for the worker log (lw#3439).
   *
   * The previous error format collapsed the response body, AI SDK warnings,
   * and OTEL flush messages into one string, making customer triage hard.
   * The adapter now throws SerializedCodeAgentAdapterError with structured
   * fields and a multi-line message that distinguishes user-code failures
   * from infra failures.
   *
   * The contract under test is the Go NLP engine's, not FastAPI's: a failed
   * run comes back 200 with `status: "error"`, and a rejected request comes
   * back non-2xx with a herr envelope. Every double is a real `Response`.
   */
  describe("when surfacing errors from the NLP service (lw#3439)", () => {
    const captureFailure = async () => {
      const adapter = new SerializedCodeAgentAdapter(
        defaultConfig,
        nlpServiceUrl,
        apiKey,
      );
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        return e as SerializedCodeAgentAdapterError;
      }
      return undefined;
    };

    describe("when the engine finalizes the run as failed", () => {
      /** @scenario adapter labels an engine failure attributed to the customer as a user-code failure */
      it("labels a node failure the engine did not attribute to itself as user code", async () => {
        mockFetch.mockImplementation(async () =>
          engineFailureResponse({
            node_id: "code_agent",
            type: "TimeoutException",
            message: "The read operation timed out",
            traceback:
              'Traceback (most recent call last):\n  File "user.py", line 4, in execute\n    raise httpx.TimeoutException("The read operation timed out")\nhttpx.TimeoutException: The read operation timed out',
          }),
        );

        const captured = await captureFailure();

        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.source).toBe("user_code");
        expect(captured!.message).toMatch(/user code raised an error/);
        expect(captured!.message).toMatch(/TimeoutException/);
        expect(captured!.message).toMatch(/httpx\.TimeoutException/);
        expect(captured!.endpoint).toBe(
          `${nlpServiceUrl}/go/studio/execute_sync`,
        );
        // The internal NLP endpoint must NOT leak into the customer-visible
        // message — it is persisted onto the scenario-run record (lw#3439).
        expect(captured!.message).not.toMatch(/localhost:8080/);
        expect(captured!.message).not.toMatch(/execute_sync/);
      });

      /**
       * Without this the run resolves to an empty agent reply: the adapter
       * only inspected `!response.ok`, and a failed run is a 200 whose
       * `result` is omitted. That is the silent-swallow lw#3439 reports.
       */
      /** @scenario a failed run is surfaced as an error instead of an empty agent reply */
      it("rejects rather than returning an empty reply", async () => {
        mockFetch.mockImplementation(async () =>
          engineFailureResponse({
            type: "AttributeError",
            message: "module 'os' has no attribute 'ABSENT'",
          }),
        );

        const adapter = new SerializedCodeAgentAdapter(
          defaultConfig,
          nlpServiceUrl,
          apiKey,
        );

        await expect(adapter.call(defaultInput)).rejects.toBeInstanceOf(
          SerializedCodeAgentAdapterError,
        );
      });

      /** @scenario adapter labels an engine failure attributed to the platform as an NLP service failure */
      it("labels an engine_error as an infra (NLP service) failure", async () => {
        mockFetch.mockImplementation(async () =>
          engineFailureResponse({
            type: "engine_error",
            message: "nil pointer dereference",
          }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("nlp_service");
        expect(captured!.message).toMatch(
          /NLP service failed while running the workflow/,
        );
        expect(captured!.message).not.toMatch(/user code raised/);
      });

      /** @scenario adapter strips AI SDK warnings and OTEL noise from the surfaced message */
      it("strips AI SDK warnings and OTEL flush chatter from the rendered message", async () => {
        const traceback = [
          'AI SDK Warning (openai.chat / openai/gpt-5.2): The feature "specificationVersion" is used in a compatibility mode.',
          "Flushing OTEL traces...",
          "OTEL traces flushed",
          "",
          "ValueError: Bad input",
        ].join("\n");
        mockFetch.mockImplementation(async () =>
          engineFailureResponse({
            type: "ValueError",
            message: "Bad input",
            traceback,
          }),
        );

        const captured = await captureFailure();

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
        mockFetch.mockImplementation(async () =>
          engineFailureResponse({
            type: "ValueError",
            message: "too long",
            traceback: huge,
          }),
        );

        const captured = await captureFailure();

        expect(captured!.message).toMatch(
          /truncated, original was 10000 chars/,
        );
        expect(captured!.message.length).toBeLessThan(huge.length);
        expect(captured!.rawDetail).toBe(huge);
        // `rawDetail` is an internal field a customer cannot reach, so the
        // persisted message must not name it (copywriting.md).
        expect(captured!.message).not.toMatch(/rawDetail/);
      });
    });

    /**
     * Recorded-contract tests. The bodies below are REAL bytes captured from a
     * running nlpgo engine (Go + Python subprocess) — see the fixture's
     * `_comment` for how to re-record. Hand-written mocks are what let this
     * adapter classify against a FastAPI contract the engine never served, so
     * the contract itself is now pinned by recorded evidence rather than by
     * an author's belief about it (lw#3439).
     */
    describe("when replaying responses recorded from a live nlpgo engine", () => {
      /** @scenario adapter classifies a response recorded from the live engine */
      it("classifies the recorded user-code failure as user_code", async () => {
        const rec = recordedNlpgoResponses.userCodeRaises;
        mockFetch.mockImplementation(
          async () =>
            new Response(JSON.stringify(rec.body), { status: rec.status }),
        );

        const captured = await captureFailure();

        // The engine returned 200 — a failed run is not a non-2xx.
        expect(rec.status).toBe(200);
        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.source).toBe("user_code");
        expect(captured!.message).toMatch(/user code raised an error/);
        expect(captured!.message).toMatch(/httpx\.TimeoutException/);
      });

      /** @scenario adapter does not blame user code for a workflow this adapter itself built */
      it("classifies the recorded invalid_workflow as an infra failure", async () => {
        const rec = recordedNlpgoResponses.invalidWorkflow;
        mockFetch.mockImplementation(
          async () =>
            new Response(JSON.stringify(rec.body), { status: rec.status }),
        );

        const captured = await captureFailure();

        // The adapter synthesizes the DSL, so a parse failure is ours.
        expect(captured!.source).toBe("nlp_service");
        expect(captured!.message).not.toMatch(/user code raised/);
      });
    });

    describe("when the engine rejects the request", () => {
      /** @scenario adapter does not blame user code for a rejected API key */
      it("labels a rejected credential as an infra failure, not user code", async () => {
        mockFetch.mockImplementation(async () =>
          herrResponse({
            status: 401,
            type: "unauthorized",
            message: "invalid api key",
          }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("nlp_service");
        expect(captured!.message).not.toMatch(/user code raised/);
      });

      /** @scenario adapter labels a status it cannot attribute as an NLP service failure */
      it("labels a status outside the customer-fault set as an infra failure", async () => {
        mockFetch.mockImplementation(async () =>
          herrResponse({
            status: 503,
            type: "child_unavailable",
            message: "service down",
          }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("nlp_service");
        expect(captured!.httpStatus).toBe(503);
        expect(captured!.message).toMatch(/NLP service returned HTTP 503/);
        expect(captured!.message).toMatch(/service down/);
      });

      it("labels a bad_request herr envelope as a user-code failure", async () => {
        mockFetch.mockImplementation(async () =>
          herrResponse({
            status: 400,
            type: "bad_request",
            message: "engine rejected the workflow",
            meta: { reason: "engine_error" },
          }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("user_code");
        expect(captured!.httpStatus).toBe(400);
        expect(captured!.message).toMatch(/user code raised an error/);
      });

      /** @scenario adapter preserves a non-JSON error body instead of dropping it */
      it("preserves a non-JSON error body instead of rendering it empty", async () => {
        mockFetch.mockImplementation(
          async () =>
            new Response("<html><body>502 Bad Gateway</body></html>", {
              status: 502,
            }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("nlp_service");
        expect(captured!.httpStatus).toBe(502);
        expect(captured!.message).toMatch(/NLP service returned HTTP 502/);
        // The json()-then-text() fallback used to lose the body entirely
        // because json() had already consumed the stream.
        expect(captured!.message).toMatch(/502 Bad Gateway/);
        expect(captured!.message).not.toMatch(/\(empty\)/);
      });

      /** @scenario adapter does not crash when the error envelope carries a non-string detail */
      it("renders a non-string detail instead of crashing the formatter", async () => {
        mockFetch.mockImplementation(async () =>
          jsonResponse(
            { detail: [{ loc: ["body", "workflow"], msg: "field required" }] },
            500,
          ),
        );

        const captured = await captureFailure();

        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.message).toMatch(/field required/);
      });

      /** @scenario adapter still understands the legacy detail-only error envelope */
      it("still classifies a legacy 500 + detail body as user code", async () => {
        mockFetch.mockImplementation(async () =>
          jsonResponse({ detail: "ValueError: legacy shape" }, 500),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("user_code");
        expect(captured!.message).toMatch(/user code raised an error/);
        expect(captured!.message).toMatch(/ValueError: legacy shape/);
      });
    });

    describe("when the request never completes", () => {
      /** @scenario adapter labels a fetch failure as a network error */
      it("labels a fetch-time failure as a network error", async () => {
        mockFetch.mockRejectedValue(new TypeError("fetch failed"));

        const captured = await captureFailure();

        expect(captured!.source).toBe("network");
        expect(captured!.message).toMatch(/failed to reach NLP service/);
        expect(captured!.message).toMatch(/fetch failed/);
      });

      /** @scenario a fetch failure does not leak the internal NLP host and port */
      it("does not leak the internal host and port from the fetch cause", async () => {
        // The shape undici actually produces: a TypeError whose cause names
        // the address. The message is persisted onto the run record, so the
        // internal address must not survive into it.
        const cause = Object.assign(
          new Error("connect ECONNREFUSED 10.4.2.11:5561"),
          { code: "ECONNREFUSED" },
        );
        mockFetch.mockRejectedValue(new TypeError("fetch failed", { cause }));

        const captured = await captureFailure();

        expect(captured!.source).toBe("network");
        expect(captured!.message).toMatch(/ECONNREFUSED/);
        expect(captured!.message).not.toMatch(/10\.4\.2\.11/);
        expect(captured!.message).not.toMatch(/5561/);
      });

      /** @scenario adapter labels an aborted fetch as a timeout */
      it("labels an aborted fetch (timeout) with source=timeout", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) =>
            abortAwareFetch(opts.signal),
        );

        vi.useFakeTimers();
        let captured: SerializedCodeAgentAdapterError | undefined;
        try {
          const adapter = new SerializedCodeAgentAdapter(
            defaultConfig,
            nlpServiceUrl,
            apiKey,
          );
          const callPromise = adapter
            .call(defaultInput)
            .catch((e: SerializedCodeAgentAdapterError) => {
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

      /**
       * The abort timer stays armed after headers arrive. A real Response
       * backed by a stream that errors on abort reproduces what undici does;
       * the rejection lands outside the fetch try/catch, where a bare
       * "The operation was aborted." used to escape unwrapped.
       */
      /** @scenario a timeout while the response body is still streaming is surfaced as a timeout */
      it("classifies an abort during the body read as a timeout", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) => {
            const body = new ReadableStream({
              start(controller) {
                opts.signal.addEventListener("abort", () => {
                  controller.error(
                    new DOMException(
                      "The operation was aborted.",
                      "AbortError",
                    ),
                  );
                });
              },
            });
            return new Response(body, { status: 200 });
          },
        );

        vi.useFakeTimers();
        let captured: SerializedCodeAgentAdapterError | undefined;
        try {
          const adapter = new SerializedCodeAgentAdapter(
            defaultConfig,
            nlpServiceUrl,
            apiKey,
          );
          const callPromise = adapter
            .call(defaultInput)
            .catch((e: SerializedCodeAgentAdapterError) => {
              captured = e;
            });
          await vi.advanceTimersByTimeAsync(120_001);
          await callPromise;
        } finally {
          vi.useRealTimers();
        }
        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.source).toBe("timeout");
        expect(captured!.message).toMatch(/did not respond within 120000ms/);
      });
    });
  });
});
