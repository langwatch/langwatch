/**
 * The IO wrapper both read paths (the traces-v2 drawer and the legacy
 * TraceService) share for Claude Code content enrichment.
 *
 * Claude Code's real `llm_request` spans carry tokens + `request_id` but no
 * message content and no cost; both live in the trace's OTLP log records. This
 * pins the three things the wrapper owns: the gate (a trace with nothing to
 * join never touches the log store), the join, and best-effort degradation.
 */
import { describe, expect, it, vi } from "vitest";
import type { Span } from "~/server/tracer/types";
import {
  contentAttrKeys,
  enrichCodingAgentSpansFromLogs,
  enrichSingleSpanWithClaudeLogContent,
} from "../claude-code-log-enrichment";
import type { LogRecordStorageService } from "../log-record-storage.service";
import type { StoredLogRecordRow } from "../repositories/log-record-storage.repository";

const PROJECT_ID = "project_test";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const REQUEST_ID = "req_011CcuGBf1aBcDeFgHiJkLmN";
const REPL = "repl_main_thread";

function span(params: Record<string, unknown> | null): Span {
  return {
    span_id: "span-1",
    parent_id: null,
    trace_id: TRACE_ID,
    type: "llm",
    name: "claude_code.llm_request",
    input: null,
    output: null,
    error: null,
    timestamps: {
      started_at: 1_700_000_000_000,
      finished_at: 1_700_000_001_000,
    },
    metrics: { prompt_tokens: 120, completion_tokens: 8, cost: null },
    params,
    model: "claude-opus-4-8[1m]",
    vendor: "anthropic",
  } as Span;
}

function logRow(attributes: Record<string, string>): StoredLogRecordRow {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs: 100,
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: {},
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

/** Light path: no api_*_body events, so content rides prompt/response. */
const LIGHT_LOGS: StoredLogRecordRow[] = [
  logRow({
    "event.name": "user_prompt",
    prompt: "summarise the repo",
    query_source: REPL,
  }),
  logRow({
    "event.name": "api_request",
    request_id: REQUEST_ID,
    query_source: REPL,
    cost_usd: "0.0421",
  }),
  logRow({
    "event.name": "assistant_response",
    request_id: REQUEST_ID,
    query_source: REPL,
    response: "Here is the summary.",
  }),
];

function logStore(
  getLogsByTraceId: LogRecordStorageService["getLogsByTraceId"],
): LogRecordStorageService {
  return { getLogsByTraceId } as unknown as LogRecordStorageService;
}

function enrich({
  spans,
  logRecords,
}: {
  spans: Span[];
  logRecords: LogRecordStorageService;
}) {
  return enrichCodingAgentSpansFromLogs({
    logRecords,
    tenantId: PROJECT_ID,
    traceId: TRACE_ID,
    spans,
    occurredAtMs: 1_700_000_000_000,
  });
}

describe("enrichCodingAgentSpansFromLogs", () => {
  describe("given spans that carry a request_id and their content logs", () => {
    it("joins the prompt, the response, and the authoritative cost onto the span", async () => {
      const getLogs = vi.fn().mockResolvedValue(LIGHT_LOGS);

      const [enriched] = await enrich({
        spans: [span({ request_id: REQUEST_ID, query_source: REPL })],
        logRecords: logStore(getLogs),
      });

      expect(enriched?.input).toEqual({
        type: "text",
        value: "summarise the repo",
      });
      expect(enriched?.output).toEqual({
        type: "text",
        value: "Here is the summary.",
      });
      expect(enriched?.metrics?.cost).toBe(0.0421);
    });

    it("leaves the span's real token metrics alone", async () => {
      const [enriched] = await enrich({
        spans: [span({ request_id: REQUEST_ID, query_source: REPL })],
        logRecords: logStore(vi.fn().mockResolvedValue(LIGHT_LOGS)),
      });

      expect(enriched?.metrics?.prompt_tokens).toBe(120);
      expect(enriched?.metrics?.completion_tokens).toBe(8);
    });
  });

  describe("given no span carries a request_id", () => {
    it("never reads the log store", async () => {
      const getLogs = vi.fn().mockResolvedValue(LIGHT_LOGS);
      const spans = [span({ "gen_ai.system": "openai" })];

      const result = await enrich({ spans, logRecords: logStore(getLogs) });

      expect(getLogs).not.toHaveBeenCalled();
      expect(result).toBe(spans);
    });
  });

  describe("when the log read fails", () => {
    it("degrades to the un-enriched spans instead of failing the trace read", async () => {
      const spans = [span({ request_id: REQUEST_ID, query_source: REPL })];

      const result = await enrich({
        spans,
        logRecords: logStore(
          vi.fn().mockRejectedValue(new Error("clickhouse down")),
        ),
      });

      expect(result).toBe(spans);
      expect(result[0]?.input ?? null).toBeNull();
    });
  });
});

function toolSpan(over: Partial<Span> = {}): Span {
  return {
    ...span({
      tool_use_id: "toolu_01AbCdEfGhIjKlMnOpQrStUv",
      tool_name: "Bash",
    }),
    span_id: "tool-span-1",
    type: "tool",
    name: "claude_code.tool",
    ...over,
  } as Span;
}

function interactionSpan(over: Partial<Span> = {}): Span {
  return {
    ...span({ user_prompt: "hello claudinho" }),
    span_id: "interaction-1",
    type: "span",
    name: "claude_code.interaction",
    ...over,
  } as Span;
}

const TOOL_LOGS: StoredLogRecordRow[] = [
  logRow({
    "event.name": "tool_decision",
    tool_use_id: "toolu_01AbCdEfGhIjKlMnOpQrStUv",
    tool_name: "Bash",
    tool_parameters: '{"command":"wc -l notes.txt"}',
    decision: "accept",
    source: "config",
  }),
  logRow({
    "event.name": "tool_result",
    tool_use_id: "toolu_01AbCdEfGhIjKlMnOpQrStUv",
    tool_name: "Bash",
    tool_input: '{"command":"wc -l notes.txt","description":"Count lines"}',
    success: "true",
    duration_ms: "820",
    tool_result_size_bytes: "799",
  }),
];

describe("enrichCodingAgentSpansFromLogs — tool and interaction spans", () => {
  describe("given a tool span with tool_use_id and its tool logs", () => {
    it("reads the log store (widened gate) and joins tool input + outcome", async () => {
      const getLogs = vi.fn().mockResolvedValue(TOOL_LOGS);

      const [enriched] = await enrich({
        spans: [toolSpan()],
        logRecords: logStore(getLogs),
      });

      expect(getLogs).toHaveBeenCalledTimes(1);
      expect(enriched?.input).toEqual({
        type: "json",
        value: { command: "wc -l notes.txt", description: "Count lines" },
      });
      expect(enriched?.output).toMatchObject({
        type: "json",
        value: { status: "completed", success: true, durationMs: 820 },
      });
    });
  });

  describe("given an interaction span", () => {
    it("takes its input from the span's own user_prompt attribute without needing logs", async () => {
      const getLogs = vi.fn().mockResolvedValue([]);

      const [enriched] = await enrich({
        spans: [interactionSpan()],
        logRecords: logStore(getLogs),
      });

      expect(enriched?.input).toEqual({
        type: "text",
        value: "hello claudinho",
      });
    });

    it("takes its output from the last conversational reply inside the turn window", async () => {
      const reply = logRow({
        "event.name": "assistant_response",
        request_id: REQUEST_ID,
        query_source: REPL,
        response: "E aí! Tudo bem?",
      });
      reply.timeUnixMs = 1_700_000_000_500;
      const getLogs = vi.fn().mockResolvedValue([reply]);

      const [enriched] = await enrich({
        spans: [interactionSpan()],
        logRecords: logStore(getLogs),
      });

      expect(enriched?.output).toEqual({
        type: "text",
        value: "E aí! Tudo bem?",
      });
    });

    it("still applies the attribute-only input when the log read fails", async () => {
      const getLogs = vi.fn().mockRejectedValue(new Error("CH down"));

      const [enriched] = await enrich({
        spans: [interactionSpan()],
        logRecords: logStore(getLogs),
      });

      expect(enriched?.input).toEqual({
        type: "text",
        value: "hello claudinho",
      });
      expect(enriched?.output).toBeNull();
    });
  });

  describe("given a trace with nothing joinable", () => {
    it("never touches the log store", async () => {
      const getLogs = vi.fn();

      await enrich({
        spans: [span(null)],
        logRecords: logStore(getLogs),
      });

      expect(getLogs).not.toHaveBeenCalled();
    });
  });
});

describe("enrichSingleSpanWithClaudeLogContent", () => {
  describe("given a tool span (exact join, no sibling refs needed)", () => {
    it("joins tool input and outcome from the trace logs", () => {
      const enriched = enrichSingleSpanWithClaudeLogContent({
        span: toolSpan(),
        modelCallRefs: [],
        logRows: TOOL_LOGS,
      });

      expect(enriched.input).toEqual({
        type: "json",
        value: { command: "wc -l notes.txt", description: "Count lines" },
      });
      expect(enriched.output).toMatchObject({
        type: "json",
        value: { status: "completed" },
      });
    });
  });

  describe("given a model-call span that is NOT the trace's first call", () => {
    it("pairs its input by the full trace's call order, not as if it were first", () => {
      const secondCallSpan = {
        ...span({ request_id: "req_second", query_source: REPL }),
        span_id: "span-2",
      } as Span;
      const body = (turn: string, timeUnixMs: number) => {
        const row = logRow({
          "event.name": "api_request_body",
          query_source: REPL,
          body: JSON.stringify({
            model: "claude-sonnet-4",
            messages: [{ role: "user", content: turn }],
          }),
        });
        row.timeUnixMs = timeUnixMs;
        return row;
      };
      const logs: StoredLogRecordRow[] = [
        body("first turn prompt", 100),
        body("second turn prompt", 200),
      ];

      const enriched = enrichSingleSpanWithClaudeLogContent({
        span: secondCallSpan,
        modelCallRefs: [
          { spanId: "span-1", requestId: "req_first", querySource: REPL },
          { spanId: "span-2", requestId: "req_second", querySource: REPL },
        ],
        logRows: logs,
      });

      // Without sibling refs the single span would positionally claim the
      // FIRST request body; with them it pairs with its own (the second).
      expect(enriched.input).toEqual({
        type: "chat_messages",
        value: [{ role: "user", content: "second turn prompt" }],
      });
    });

    it("never fabricates a positional input when sibling refs are unavailable", () => {
      const secondCallSpan = {
        ...span({ request_id: "req_second", query_source: REPL }),
        span_id: "span-2",
      } as Span;

      const enriched = enrichSingleSpanWithClaudeLogContent({
        span: secondCallSpan,
        modelCallRefs: [],
        logRows: LIGHT_LOGS,
      });

      expect(enriched.input).toBeNull();
      // Exact request_id joins (output / cost) still apply when they match.
      expect(enriched.output).toBeNull();
    });
  });
});

describe("contentAttrKeys — tool events", () => {
  it("withholds tool_input and tool_parameters for tool_result (policy parity with the span surface)", () => {
    expect(contentAttrKeys("tool_result")).toEqual([
      "tool_input",
      "tool_parameters",
      "body",
    ]);
  });

  it("withholds tool_parameters for tool_decision", () => {
    expect(contentAttrKeys("tool_decision")).toEqual([
      "tool_parameters",
      "body",
    ]);
  });
});
