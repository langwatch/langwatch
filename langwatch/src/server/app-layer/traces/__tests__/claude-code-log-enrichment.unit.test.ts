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
import { enrichCodingAgentSpansFromLogs } from "../claude-code-log-enrichment";
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
