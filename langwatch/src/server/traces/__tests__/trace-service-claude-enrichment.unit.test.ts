/**
 * TraceService.getById read-time Claude Code content enrichment, exercised at
 * the real seam: the ClickHouse trace read + the log-record store are mocked
 * boundaries (no Docker), the enrichment adapter + pure join run for real.
 *
 * A coding-agent-origin trace's real `llm_request` span carries `request_id`
 * but no message content and no cost; the content + cost live in the trace's
 * OTLP log records. getById must join capped `input` / `output` + the
 * authoritative `cost` onto the span. A non-coding-agent trace must not even
 * read the logs. Boundaries are all mocked so this belongs in unit (mirrors the
 * sibling trace-service-4888-full-flag.unit.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogRecordStorageService } from "~/server/app-layer/traces/log-record-storage.service";
import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import type { Span, Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";

const {
  mockGetTracesWithSpans,
  mockGetTracesByThreadId,
  mockGetTracesWithSpansByThreadIds,
} = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
  mockGetTracesByThreadId: vi.fn(),
  mockGetTracesWithSpansByThreadIds: vi.fn(),
}));

vi.mock("../clickhouse-trace.service", () => ({
  ClickHouseTraceService: Object.assign(vi.fn(), {
    create: () => ({
      getTracesWithSpans: mockGetTracesWithSpans,
      getTracesByThreadId: mockGetTracesByThreadId,
      getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
      resolveTraceIdByPrefix: vi.fn().mockResolvedValue([]),
    }),
  }),
}));

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), { create: () => ({}) }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
  isClickHouseEnabled: () => false,
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = { setAttribute: () => {}, setAttributes: () => {} };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

import { TraceService } from "../trace.service";

const PROJECT_ID = "project_test";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const REQUEST_ID = "req_011CcuGBf1aBcDeFgHiJkLmN";
const REPL = "repl_main_thread";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

function claudeLlmSpan(over: Partial<Span> = {}): Span {
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
    params: { request_id: REQUEST_ID, query_source: REPL },
    model: "claude-opus-4-8[1m]",
    vendor: "anthropic",
    ...over,
  } as Span;
}

function makeTrace({
  origin,
  spans,
}: {
  origin: string;
  spans: Span[];
}): Trace {
  return {
    trace_id: TRACE_ID,
    project_id: PROJECT_ID,
    metadata: { "langwatch.origin": origin },
    timestamps: {
      started_at: 1_700_000_000_000,
      inserted_at: 1_700_000_000_000,
      updated_at: 1_700_000_001_000,
    },
    spans,
  } as Trace;
}

function logRow(
  attributes: Record<string, string>,
  timeUnixMs: number,
): StoredLogRecordRow {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs,
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: { "langwatch.origin": "coding_agent" },
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

/**
 * The light events: user_prompt (input), api_request (cost), assistant_response
 * (output) — i.e. the shape emitted WITHOUT `OTEL_LOG_RAW_API_BODIES`.
 *
 * Each event carries its content under its OWN attribute key — there is no
 * shared `body` convention (https://code.claude.com/docs/en/monitoring-usage):
 *   user_prompt        → `prompt`
 *   assistant_response → `response`
 *   api_*_body         → `body`
 * Enrichment used to read `body` for all of them, so on this light path the span
 * came back with NO input and NO output, silently. Keep this fixture on the real
 * wire keys so that regression stays caught.
 */
const CLAUDE_LOG_ROWS: StoredLogRecordRow[] = [
  logRow(
    {
      "event.name": "user_prompt",
      prompt: "summarise the repo",
      query_source: REPL,
    },
    100,
  ),
  logRow(
    {
      "event.name": "api_request",
      request_id: REQUEST_ID,
      query_source: REPL,
      cost_usd: "0.0421",
    },
    200,
  ),
  logRow(
    {
      "event.name": "assistant_response",
      request_id: REQUEST_ID,
      query_source: REPL,
      response: "Here is the summary.",
    },
    210,
  ),
];

function makeService(
  getLogsByTraceId: LogRecordStorageService["getLogsByTraceId"],
): TraceService {
  return new TraceService({} as never, undefined, {
    getLogsByTraceId,
  } as unknown as LogRecordStorageService);
}

describe("TraceService.getById — Claude Code log content enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a coding-agent-origin trace with a real llm_request span and its content logs", () => {
    it("joins capped input, output, and the authoritative cost onto the span", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);
      const span = trace?.spans?.[0];

      expect(span?.input).toEqual({
        type: "text",
        value: "summarise the repo",
      });
      expect(span?.output).toEqual({
        type: "text",
        value: "Here is the summary.",
      });
      expect(span?.metrics?.cost).toBe(0.0421);
    });

    it("reads the trace's logs once, time-capped by the trace's start time", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(getLogs).toHaveBeenCalledTimes(1);
      expect(getLogs).toHaveBeenCalledWith(
        PROJECT_ID,
        TRACE_ID,
        1_700_000_000_000,
      );
    });

    it("preserves the span's real token metrics while overriding cost", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const service = makeService(vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS));

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(trace?.spans?.[0]?.metrics?.prompt_tokens).toBe(120);
      expect(trace?.spans?.[0]?.metrics?.completion_tokens).toBe(8);
    });
  });

  describe("given a non-coding-agent trace", () => {
    it("does not read the logs and leaves the spans untouched", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(getLogs).not.toHaveBeenCalled();
      expect(trace?.spans?.[0]?.input ?? null).toBeNull();
      expect(trace?.spans?.[0]?.output ?? null).toBeNull();
    });
  });

  describe("given a coding-agent trace with no content logs", () => {
    it("no-ops, returning the spans unchanged", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const service = makeService(vi.fn().mockResolvedValue([]));

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(trace?.spans?.[0]?.input ?? null).toBeNull();
      expect(trace?.spans?.[0]?.metrics?.cost ?? null).toBeNull();
    });
  });

  describe("given the log read fails", () => {
    it("degrades to the un-enriched trace instead of throwing", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const service = makeService(
        vi.fn().mockRejectedValue(new Error("clickhouse down")),
      );

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(trace?.spans?.[0]?.input ?? null).toBeNull();
    });
  });
});

/**
 * G1: enrichment must also reach the multi-trace read paths (evals, export,
 * legacy thread reads), not just `getById`. Each of these methods returns whole
 * spans that exports + evaluators read, so a coding-agent trace fetched through
 * them must be enriched the same way, and a non-coding-agent trace must never
 * trigger a log read.
 */
describe("TraceService — multi-trace read enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const enrichedInput = { type: "text", value: "summarise the repo" };
  const enrichedOutput = { type: "text", value: "Here is the summary." };

  describe("when reading via getTracesWithSpans", () => {
    it("enriches a coding-agent trace with input, output, and cost", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const traces = await service.getTracesWithSpans(
        PROJECT_ID,
        [TRACE_ID],
        protections,
      );

      expect(traces[0]?.spans?.[0]?.input).toEqual(enrichedInput);
      expect(traces[0]?.spans?.[0]?.output).toEqual(enrichedOutput);
      expect(traces[0]?.spans?.[0]?.metrics?.cost).toBe(0.0421);
      expect(getLogs).toHaveBeenCalledTimes(1);
    });

    it("does not read logs for a non-coding-agent trace", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const traces = await service.getTracesWithSpans(
        PROJECT_ID,
        [TRACE_ID],
        protections,
      );

      expect(getLogs).not.toHaveBeenCalled();
      expect(traces[0]?.spans?.[0]?.input ?? null).toBeNull();
    });
  });

  describe("when reading via getTracesByThreadId", () => {
    it("enriches a coding-agent trace returned for the thread", async () => {
      mockGetTracesByThreadId.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const traces = await service.getTracesByThreadId(
        PROJECT_ID,
        "thread-1",
        protections,
      );

      expect(traces[0]?.spans?.[0]?.input).toEqual(enrichedInput);
      expect(traces[0]?.spans?.[0]?.metrics?.cost).toBe(0.0421);
    });

    it("does not read logs for a non-coding-agent trace", async () => {
      mockGetTracesByThreadId.mockResolvedValue([
        makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      await service.getTracesByThreadId(PROJECT_ID, "thread-1", protections);

      expect(getLogs).not.toHaveBeenCalled();
    });
  });

  describe("when reading via getTracesWithSpansByThreadIds", () => {
    it("enriches each coding-agent trace, reading logs per trace", async () => {
      mockGetTracesWithSpansByThreadIds.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
        makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const traces = await service.getTracesWithSpansByThreadIds(
        PROJECT_ID,
        ["thread-1"],
        protections,
      );

      // Only the coding-agent trace is enriched; only its log read happens.
      expect(traces[0]?.spans?.[0]?.input).toEqual(enrichedInput);
      expect(traces[1]?.spans?.[0]?.input ?? null).toBeNull();
      expect(getLogs).toHaveBeenCalledTimes(1);
    });

    it("does not read logs when no trace is coding-agent origin", async () => {
      mockGetTracesWithSpansByThreadIds.mockResolvedValue([
        makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
      ]);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      await service.getTracesWithSpansByThreadIds(
        PROJECT_ID,
        ["thread-1"],
        protections,
      );

      expect(getLogs).not.toHaveBeenCalled();
    });
  });
});
