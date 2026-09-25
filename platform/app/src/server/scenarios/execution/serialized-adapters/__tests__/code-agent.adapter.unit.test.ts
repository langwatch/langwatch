/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardAgainstGlobalFetch } from "../../../../../test-utils/globalFetchGuard";
import { closeNlpFetchDispatchers } from "../../../../nlpgo/timeouts";
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

// The adapter calls undici's own fetch, so that export is the interception
// point. Hoisted, because the vi.mock factory below is hoisted above this file.
const mockFetch = vi.hoisted(() => vi.fn());

// Undici's Agent does not read back the timeouts it was constructed with, so
// the only way to assert on the dispatcher the adapter passes is to record the
// constructor's arguments.
const agentOptions = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return {
    ...actual,
    fetch: mockFetch,
    Agent: class RecordingAgent extends actual.Agent {
      constructor(opts?: Record<string, unknown>) {
        agentOptions.push(opts ?? {});
        super(opts);
      }
    },
  };
});

// Pointing the global fetch at the same mock would let a regression back to it
// pass this suite, which is how that bug reached production once already.
guardAgainstGlobalFetch();

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
   * NLP service /studio/execute_sync success response. The adapter reads the
   * body once via `response.text()` and JSON-parses it itself, so `text` must
   * carry the real serialized body — not the empty string a `.json()`-only
   * mock could get away with before the adapter stopped calling `.json()`.
   */
  const nlpResponse = (result: Record<string, unknown> | null) => {
    const body = { trace_id: "trace_abc123", status: "success", result };
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    };
  };

  /**
   * A real `Response`, used by the error-surfacing suite below (lw#3439).
   *
   * A plain `{ ok, status, json, text }` literal has independently callable,
   * infinitely re-readable `json`/`text`, so it cannot reproduce body-stream
   * semantics — which is what let a non-JSON body ship dropped and let a
   * `{ detail }` fixture encode a contract the Go engine never serves. Built
   * with the constructor, `.text()`/`.status`/`.ok` all come for free.
   */
  const jsonResponse = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

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

  // Fetch implementation that rejects with AbortError as soon as the
  // controller's signal aborts. Returning the promise via async/await keeps
  // the rejection attached to the awaited chain, avoiding spurious
  // "unhandled rejection" warnings when fake timers drive the abort. Shared
  // across the error-surfacing timeout tests (lw#3439).
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

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,

    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    withActiveSpanCalls.length = 0;
    agentOptions.length = 0;
    // createNlpFetchDispatcher now memoizes by timeoutMs at module scope
    // (nlpgo/timeouts.ts). Without clearing the cache here, a dispatcher
    // built by an earlier test for the same timeoutMs is returned again
    // without touching the mocked undici.Agent constructor, so agentOptions
    // stays empty and this test's assertions see stale/undefined values.
    await closeNlpFetchDispatchers();
    // Pin the timeout explicitly so the test doesn't rely on ambient env.
    // Stubbed, not assigned: a raw assignment here outlives the file and
    // reaches whatever else shares this vitest worker.
    vi.stubEnv("NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS", "600");
    // clearAllMocks keeps implementations, so pin the no-active-context
    // default here; tests that need a trace context override it themselves.
    mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
      headers,
      traceId: undefined,
    }));
    mockFetch.mockResolvedValue(nlpResponse({ output: "processed: Hello" }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    it("extracts user code error detail from a legacy 500 JSON response", async () => {
      mockFetch.mockImplementation(async () =>
        jsonResponse({ detail: "Python runtime error" }, 500),
      );

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        /user code raised an error[\s\S]+Python runtime error/,
      );
    });

    it("preserves a non-JSON error body on the surfaced message", async () => {
      mockFetch.mockImplementation(
        async () => new Response("Bad Gateway", { status: 502 }),
      );

      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });

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

    // The abort signal above is not the only deadline in play: undici's own
    // headersTimeout lives on the dispatcher and defaults to 300s, so without
    // one sized to this adapter's deadline a longer run dies at 300s no matter
    // how far out the abort is armed.
    it("passes a dispatcher whose headers timeout matches the adapter's own fetch timeout", async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl: nlpServiceUrl,
        projectApiKey: apiKey,
      });
      await adapter.call(defaultInput);

      const fetchOptions = mockFetch.mock.calls[0]![1];
      expect(fetchOptions.dispatcher).toBeDefined();
      expect(agentOptions.at(-1)?.headersTimeout).toBeGreaterThan(300_000);
      expect(agentOptions.at(-1)?.headersTimeout).toBe(
        agentOptions.at(-1)?.bodyTimeout,
      );
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

  describe("given a code agent with an input mapped to the scenario session", () => {
    const sessionConfig: CodeAgentData = {
      ...defaultConfig,
      inputs: [
        { identifier: "input", type: "str" },
        { identifier: "session", type: "dict" },
      ],
      scenarioMappings: {
        input: { type: "source", sourceId: "scenario", path: ["input"] },
        session: { type: "source", sourceId: "scenario", path: ["session"] },
      },
    };

    /** A success reply whose code node returned `outputs` beside the end result. */
    const replyWith = (codeOutputs: Record<string, unknown>) => {
      const body = {
        trace_id: "trace_abc123",
        status: "success",
        result: { output: codeOutputs.output },
        nodes: {
          entry: { id: "entry", status: "success" },
          code_agent: {
            id: "code_agent",
            status: "success",
            outputs: codeOutputs,
          },
          end: { id: "end", status: "success" },
        },
      };
      return {
        ok: true,
        status: 200,
        // The adapter reads the body via `response.text()`, so it must carry
        // the serialized payload, not the empty string.
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
      };
    };

    /** The `session` input of the nth request the adapter sent. */
    const sentSession = (call: number): unknown => {
      const body = JSON.parse(mockFetch.mock.calls[call]?.[1]?.body as string);
      return body.payload.inputs[0].session;
    };

    const turn = (threadId: string, text: string): AgentInput => ({
      ...defaultInput,
      threadId,
      messages: [{ role: "user", content: text }],
      newMessages: [{ role: "user", content: text }],
    });

    describe("when the code returns a session beside its reply", () => {
      /** @scenario "A code agent that returns a session receives it on the next turn" */
      /** @scenario "A code agent receives no session on the first turn of a thread" */
      /** @scenario "Two threads of one code agent run do not share a session" */
      it("sends null on the first turn, the value on the next turn, and nothing to another thread", async () => {
        mockFetch
          .mockResolvedValueOnce(
            replyWith({ output: "one", session: { cursor: 7 } }),
          )
          .mockResolvedValueOnce(
            replyWith({ output: "two", session: { cursor: 8 } }),
          )
          .mockResolvedValueOnce(replyWith({ output: "other" }));
        const adapter = new SerializedCodeAgentAdapter({
          config: sessionConfig,
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await expect(adapter.call(turn("thread_a", "first"))).resolves.toBe(
          "one",
        );
        await expect(adapter.call(turn("thread_a", "second"))).resolves.toBe(
          "two",
        );
        await expect(adapter.call(turn("thread_b", "hello"))).resolves.toBe(
          "other",
        );

        expect(sentSession(0)).toBeNull();
        expect(sentSession(1)).toEqual({ cursor: 7 });
        expect(sentSession(2)).toBeNull();
      });

      it("keeps the held value when a later turn returns no session", async () => {
        mockFetch
          .mockResolvedValueOnce(
            replyWith({ output: "one", session: "conv_1" }),
          )
          .mockResolvedValueOnce(replyWith({ output: "two" }))
          .mockResolvedValueOnce(replyWith({ output: "three" }));
        const adapter = new SerializedCodeAgentAdapter({
          config: sessionConfig,
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await adapter.call(turn("thread_a", "first"));
        await adapter.call(turn("thread_a", "second"));
        await adapter.call(turn("thread_a", "third"));

        expect(sentSession(2)).toBe("conv_1");
      });
    });

    describe("when the code returns a session above the cap", () => {
      /** @scenario "A code agent session above the cap fails the turn" */
      it("fails the turn with the payload code", async () => {
        mockFetch.mockResolvedValueOnce(
          replyWith({ output: "one", session: "x".repeat(70_000) }),
        );
        const adapter = new SerializedCodeAgentAdapter({
          config: sessionConfig,
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

        await expect(adapter.call(turn("thread_a", "first"))).rejects.toThrow(
          /agent_payload_too_large/,
        );
      });
    });
  });

  describe("when surfacing errors from the NLP service (lw#3439)", () => {
    const captureFailure = async () => {
      const adapter = new SerializedCodeAgentAdapter({
        config: defaultConfig,
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
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

        const adapter = new SerializedCodeAgentAdapter({
          config: defaultConfig,
          nlpServiceUrl,
          projectApiKey: apiKey,
        });

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

    describe("when the response arrives but the run cannot be used", () => {
      const configDemandingOutputField: CodeAgentData = {
        ...defaultConfig,
        scenarioOutputField: "answer",
      };

      const captureWithOutputField = async () => {
        const adapter = new SerializedCodeAgentAdapter({
          config: configDemandingOutputField,
          nlpServiceUrl,
          projectApiKey: apiKey,
        });
        try {
          await adapter.call(defaultInput);
        } catch (e) {
          return e as SerializedCodeAgentAdapterError;
        }
        return undefined;
      };

      /** @scenario a missing declared output leaves the same structured footprint as any other failure */
      it("tags a missing declared output like every other failure", async () => {
        mockFetch.mockImplementation(async () =>
          jsonResponse(
            { trace_id: "t", status: "success", result: { unexpected: "x" } },
            200,
          ),
        );

        const captured = await captureWithOutputField();

        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.source).toBe("user_code");
        expect(captured!.kind).toBe("output");
        const span = withActiveSpanCalls.find(
          (c) => c.name === "SerializedCodeAgentAdapter.execute_nlp_request",
        );
        const kindCall = span!.span.setAttribute.mock.calls.find(
          (c) => c[0] === "error.kind",
        );
        expect(kindCall?.[1]).toBe("output");
      });

      /** @scenario a success response that is not valid JSON is surfaced as its own failure kind */
      it("does not report a malformed 200 as an HTTP failure", async () => {
        mockFetch.mockImplementation(
          async () => new Response("<html>hi</html>", { status: 200 }),
        );

        const captured = await captureFailure();

        expect(captured!.source).toBe("nlp_service");
        // An operator filtering error.kind=http must not be handed a 200.
        expect(captured!.kind).toBe("parse");
        expect(captured!.message).toMatch(/not valid JSON/);
      });

      /**
       * The hazard is narrow and the obvious test for it is vacuous: if the
       * timer never fires, `timedOut` stays false and the guard is never
       * exercised. So this models the real race — the abort fires WHILE the
       * body is streaming, and the body arrives anyway. `timedOut` is then
       * latched true over a response that demonstrably completed, and the
       * next failure downstream used to be rewritten as "the NLP service did
       * not respond within 630000ms".
       */
      /** @scenario a failure after the response arrived is not blamed on the response time */
      it("does not blame the response time for a failure that happened after it", async () => {
        mockFetch.mockImplementation(
          async (_url: string, opts: { signal: AbortSignal }) => {
            const payload = JSON.stringify({
              trace_id: "t",
              status: "success",
              result: { unexpected: "x" },
            });
            const body = new ReadableStream({
              start(controller) {
                // Deliver the body only once the abort has fired, so the
                // latch is set over a response that still completed.
                opts.signal.addEventListener("abort", () => {
                  controller.enqueue(new TextEncoder().encode(payload));
                  controller.close();
                });
              },
            });
            return new Response(body, { status: 200 });
          },
        );

        vi.useFakeTimers();
        let captured: SerializedCodeAgentAdapterError | undefined;
        try {
          const adapter = new SerializedCodeAgentAdapter({
            config: configDemandingOutputField,
            nlpServiceUrl,
            projectApiKey: apiKey,
          });
          const p = adapter
            .call(defaultInput)
            .catch((e: SerializedCodeAgentAdapterError) => {
              captured = e;
            });
          await vi.advanceTimersByTimeAsync(630_001);
          await p;
        } finally {
          vi.useRealTimers();
        }

        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.message).not.toMatch(/did not respond within/);
        expect(captured!.kind).toBe("output");
        expect(captured!.source).toBe("user_code");
      });
    });

    /** @scenario a credential echoed back by the engine never reaches the customer */
    it("never renders a credential the engine echoed back", async () => {
      // Defence-in-depth: pattern-based redaction cannot catch a credential,
      // only knowing the actual value can. This is what an upstream that
      // quotes the rejected key back at us would produce.
      const secretKey = "sk-live-abcdef0123456789";
      mockFetch.mockImplementation(async () =>
        herrResponse({
          status: 401,
          type: "unauthorized",
          message: `rejected api key ${secretKey}`,
        }),
      );

      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, secrets: { OTHER: "shh-9f3a2b7c4e" } },
        nlpServiceUrl,
        projectApiKey: secretKey,
      });
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }

      expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
      expect(captured!.message).not.toMatch(/sk-live-abcdef0123456789/);
      expect(captured!.rawDetail ?? "").not.toMatch(/sk-live-abcdef0123456789/);
      expect(captured!.message).toMatch(/\[redacted\]/);
    });

    it("never renders a project secret the engine echoed back", async () => {
      const projectSecret = "shh-9f3a2b7c4e";
      mockFetch.mockImplementation(async () =>
        engineFailureResponse({
          type: "ValueError",
          message: `bad value ${projectSecret}`,
          traceback: `ValueError: bad value ${projectSecret}`,
        }),
      );

      const adapter = new SerializedCodeAgentAdapter({
        config: { ...defaultConfig, secrets: { TOKEN: projectSecret } },
        nlpServiceUrl,
        projectApiKey: apiKey,
      });
      let captured: SerializedCodeAgentAdapterError | undefined;
      try {
        await adapter.call(defaultInput);
      } catch (e) {
        captured = e as SerializedCodeAgentAdapterError;
      }

      expect(captured!.message).not.toMatch(/shh-9f3a2b7c4e/);
      expect(captured!.rawDetail ?? "").not.toMatch(/shh-9f3a2b7c4e/);
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
        // No `.code` on the inner cause: with one, the renderer prefers it
        // and returns before redaction runs, so this assertion would hold
        // whether or not anything redacted. Without one, the raw message is
        // what reaches the customer — which is the path worth pinning.
        const cause = new Error("connect ECONNREFUSED 10.4.2.11:5561");
        mockFetch.mockRejectedValue(new TypeError("fetch failed", { cause }));

        const captured = await captureFailure();

        expect(captured!.source).toBe("network");
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
          const adapter = new SerializedCodeAgentAdapter({
            config: defaultConfig,
            nlpServiceUrl,
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
        expect(captured!.source).toBe("timeout");
        expect(captured!.message).toMatch(/did not respond within 630000ms/);
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
          const adapter = new SerializedCodeAgentAdapter({
            config: defaultConfig,
            nlpServiceUrl,
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
        expect(captured).toBeInstanceOf(SerializedCodeAgentAdapterError);
        expect(captured!.source).toBe("timeout");
        expect(captured!.message).toMatch(/did not respond within 630000ms/);
      });
    });
  });
});
