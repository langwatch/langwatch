/**
 * @vitest-environment node
 *
 * TraceService.getById read-time Claude Code content enrichment, exercised at
 * the real seam: the ClickHouse trace read + the log-record store are mocked
 * boundaries (no Docker), the enrichment adapter + pure join run for real.
 *
 * A coding-agent-origin trace's real `llm_request` span carries `request_id`
 * but no message content; that lives in the trace's OTLP log records. getById
 * must join capped `input` / `output` onto the span, and must leave the cost
 * alone: it was computed from the span's own tokens at ingest, so a log record
 * cannot move it out of step with the rest of the product. A non-coding-agent
 * trace must not even read the logs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceLogRecordReader } from "../claude-code-log-enrichment.service";
import type { NormalizedSpan, Span, Trace } from "@langwatch/trace-contract";
import type { Protections } from "@langwatch/trace-server";

const {
  mockGetTracesWithSpans,
  mockGetTracesByThreadId,
  mockGetTracesWithSpansByThreadIds,
  mockGetAllTracesForProject,
} = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
  mockGetTracesByThreadId: vi.fn(),
  mockGetTracesWithSpansByThreadIds: vi.fn(),
  mockGetAllTracesForProject: vi.fn(),
}));

vi.mock("../../repositories/clickhouse/trace-legacy-read.repository", () => ({
  ClickHouseTraceService: {
    create: () => ({
      getTracesWithSpans: mockGetTracesWithSpans,
      getTracesByThreadId: mockGetTracesByThreadId,
      getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
      getAllTracesForProject: mockGetAllTracesForProject,
      resolveTraceIdByPrefix: vi.fn().mockResolvedValue([]),
    }),
  },
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

import { TraceService } from "../trace-legacy-read.service";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";

const PROJECT_ID = "project_test";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const REQUEST_ID = "req_011CcuGBf1aBcDeFgHiJkLmN";
const REPL = "repl_main_thread";
/** What ingest computed from the span's own tokens, and what every read shows. */
const STORED_COST = 0.193022;

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
    metrics: { prompt_tokens: 120, completion_tokens: 8, cost: STORED_COST },
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
): NonNullable<Awaited<ReturnType<TraceLogRecordReader["getLogsByTraceId"]>>>[number] {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs,
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: { "langwatch.origin": "coding_agent" },
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  } as NonNullable<Awaited<ReturnType<TraceLogRecordReader["getLogsByTraceId"]>>>[number];
}

const CLAUDE_LOG_ROWS = [
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
  getLogsByTraceId: TraceLogRecordReader["getLogsByTraceId"],
): TraceService {
  return TraceService.create({
    prisma: {} as never,
    traceCanonicalisation: {} as TraceCanonicalisationService,
    logRecordStorage: { getLogsByTraceId } as unknown as TraceLogRecordReader,
  });
}

describe("TraceService.getById — Claude Code log content enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a coding-agent-origin trace with a real llm_request span and its content logs", () => {
    it("joins capped input and output onto the span", async () => {
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
      expect(span?.metrics?.cost).toBe(STORED_COST);
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

    it("preserves the span's real token metrics and its stored cost", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] }),
      ]);
      const service = makeService(vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS));

      const trace = await service.getById(PROJECT_ID, TRACE_ID, protections);

      expect(trace?.spans?.[0]?.metrics?.prompt_tokens).toBe(120);
      expect(trace?.spans?.[0]?.metrics?.completion_tokens).toBe(8);
      expect(trace?.spans?.[0]?.metrics?.cost).toBe(STORED_COST);
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
      expect(trace?.spans?.[0]?.metrics?.cost).toBe(STORED_COST);
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
 * Enrichment must also reach the multi-trace read paths (evals, export,
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
    it("enriches a coding-agent trace with input and output", async () => {
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
      expect(traces[0]?.spans?.[0]?.metrics?.cost).toBe(STORED_COST);
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
      expect(traces[0]?.spans?.[0]?.metrics?.cost).toBe(STORED_COST);
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

  describe("when reading via getAllTracesForProject with includeSpans", () => {
    const searchInput = {
      projectId: PROJECT_ID,
      startDate: 1_700_000_000_000,
      endDate: 1_700_000_002_000,
      filters: {},
    };

    /** @scenario search with includeSpans returns coding-agent spans enriched from log records */
    it("enriches coding-agent traces across the page's groups", async () => {
      mockGetAllTracesForProject.mockResolvedValue({
        groups: [
          [makeTrace({ origin: "coding_agent", spans: [claudeLlmSpan()] })],
          [
            {
              ...makeTrace({ origin: "application", spans: [claudeLlmSpan()] }),
              trace_id: "b".repeat(32),
            },
          ],
        ],
        totalHits: 2,
        traceChecks: {},
      });
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const result = await service.getAllTracesForProject(
        searchInput as never,
        protections,
        { includeSpans: true },
      );

      expect(result.groups[0]?.[0]?.spans?.[0]?.input).toEqual(enrichedInput);
      expect(result.groups[0]?.[0]?.spans?.[0]?.metrics?.cost).toBe(
        STORED_COST,
      );
      expect(result.groups[1]?.[0]?.spans?.[0]?.input ?? null).toBeNull();
      expect(getLogs).toHaveBeenCalledTimes(1);
    });

    /** @scenario search without includeSpans keeps the legacy empty spans shape */
    it("does not enrich or read logs when includeSpans is not set", async () => {
      const page = {
        groups: [[makeTrace({ origin: "coding_agent", spans: [] as Span[] })]],
        totalHits: 1,
        traceChecks: {},
      };
      mockGetAllTracesForProject.mockResolvedValue(page);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const result = await service.getAllTracesForProject(
        searchInput as never,
        protections,
        {},
      );

      expect(getLogs).not.toHaveBeenCalled();
      expect(result).toBe(page);
    });

    it("returns the page untouched when no trace is coding-agent origin", async () => {
      const page = {
        groups: [
          [makeTrace({ origin: "application", spans: [claudeLlmSpan()] })],
        ],
        totalHits: 1,
        traceChecks: {},
      };
      mockGetAllTracesForProject.mockResolvedValue(page);
      const getLogs = vi.fn().mockResolvedValue(CLAUDE_LOG_ROWS);
      const service = makeService(getLogs);

      const result = await service.getAllTracesForProject(
        searchInput as never,
        protections,
        { includeSpans: true },
      );

      expect(getLogs).not.toHaveBeenCalled();
      expect(result).toBe(page);
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
