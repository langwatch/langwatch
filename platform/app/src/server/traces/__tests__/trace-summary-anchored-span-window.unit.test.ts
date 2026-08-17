/**
 * The joined span read must never emit an empty time predicate (ADR-087).
 *
 * `fetchTracesWithSpansJoined` derived its `stored_spans` window solely from the
 * matched summaries' `OccurredAt`, keeping only positive values. A page of
 * log-only traces carries the epoch sentinel in that column, so nothing
 * survived, `queryWindowed` was called with a null hint and `fallback: "none"`,
 * and BOTH the inner and outer time filters rendered as empty strings — leaving
 * a read of `ResourceAttributes`, `SpanAttributes`, `Events.Attributes` and
 * `Links.*` with no partition predicate at all, over every weekly part including
 * cold S3 tiers. That is the read production died on with
 * MEMORY_LIMIT_EXCEEDED (code 241).
 *
 * These tests assert on the SQL the service issues, because the defect IS the
 * SQL: the interpolated fragment is either there or it is not.
 */
import { describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/traces/protections";

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/filters/clickhouse", () => ({
  generateClickHouseFilterConditions: () => ({
    conditions: [],
    params: {},
    hasUnsupportedFilters: false,
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (s: unknown) => Promise<unknown>)({
        setAttribute: () => {},
        setAttributes: () => {},
      });
    },
  }),
}));

const protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
} as Protections;

const NOW = Date.now();
const RECENT_MS = NOW - 60 * 60 * 1000;

function summaryRow(traceId: string, occurredAtMs: number) {
  return {
    ts_TraceId: traceId,
    ts_SpanCount: 1,
    ts_TotalDurationMs: 100,
    ts_ComputedIOSchemaVersion: "1",
    ts_ComputedInput: null,
    ts_ComputedOutput: null,
    ts_TimeToFirstTokenMs: null,
    ts_TimeToLastTokenMs: null,
    ts_TokensPerSecond: null,
    ts_ContainsErrorStatus: false,
    ts_ContainsOKStatus: true,
    ts_ErrorMessage: "",
    ts_Models: [],
    ts_TotalCost: 0,
    ts_TokensEstimated: false,
    ts_TotalPromptTokenCount: 0,
    ts_TotalCompletionTokenCount: 0,
    ts_TopicId: null,
    ts_SubTopicId: null,
    ts_HasAnnotation: null,
    ts_AnnotationIds: [],
    ts_Attributes: {},
    ts_TraceName: null,
    ts_OccurredAt: occurredAtMs,
    ts_CreatedAt: occurredAtMs,
    ts_UpdatedAt: occurredAtMs,
  };
}

/**
 * The three reads `fetchTracesWithSpansJoined` fires when the caller supplies no
 * time range: the light min/max resolve, the summary read, then the span read.
 *
 * Routed by query shape rather than by call order, so a read gained or dropped
 * upstream surfaces here as an unmatched query rather than as the wrong payload
 * handed to the wrong read two frames away. Every shape is matched explicitly
 * and anything else throws: a default payload would hand a new read a valid-
 * looking fixture and hide exactly the break this routing exists to expose.
 */
function mockReads({
  resolved,
  summaries,
}: {
  resolved: { fromMs: number | null; toMs: number | null };
  summaries: ReturnType<typeof summaryRow>[];
}) {
  mockClickHouseQuery.mockReset();
  mockClickHouseQuery.mockImplementation(({ query }: { query: string }) => {
    const rows = matchRows({ query, resolved, summaries });
    return Promise.resolve({ json: () => Promise.resolve(rows) });
  });
}

function matchRows({
  query,
  resolved,
  summaries,
}: {
  query: string;
  resolved: { fromMs: number | null; toMs: number | null };
  summaries: ReturnType<typeof summaryRow>[];
}) {
  if (query.includes("AS fromMs")) return [resolved];
  if (query.includes("FROM trace_summaries AS t")) return summaries;
  if (query.includes("FROM stored_spans AS t")) return [];
  throw new Error(
    `fixture: fetchTracesWithSpansJoined issued a read this fixture does not know: ${query}`,
  );
}

/**
 * Drives the read and hands back the span query it issued.
 *
 * A missing span read is a broken fixture, not a failed expectation — the
 * scenarios below are all about the SHAPE of that query, so there is nothing to
 * assert if it never ran. Throwing keeps the assertions in the `it` blocks where
 * `noMisplacedAssertion` expects them, and reports a setup break as a setup
 * break rather than as a confusing `undefined` assertion failure.
 */
async function readTraces(traceIds: string[]) {
  const { ClickHouseTraceService } = await import(
    "../clickhouse-trace.service"
  );
  const service = new ClickHouseTraceService({
    prisma: {
      project: { findUnique: vi.fn() },
    } as never,
  });
  await service.getTracesWithSpans("proj-1", traceIds, protections);
  const spanCall = mockClickHouseQuery.mock.calls.find(([args]) =>
    String(args.query).includes("FROM stored_spans AS t"),
  );
  if (!spanCall) {
    throw new Error(
      "fixture: the service issued no stored_spans read, so there is no span query to inspect",
    );
  }
  return spanCall[0] as {
    query: string;
    query_params: Record<string, unknown>;
  };
}

describe("given a page of traces whose spans are read together", () => {
  describe("when every summary carries a real filing time", () => {
    /** @scenario "Spans are read from the weeks the page's traces were filed under" */
    it("bounds the span read to those traces' own weeks", async () => {
      mockReads({
        resolved: { fromMs: RECENT_MS, toMs: RECENT_MS },
        summaries: [summaryRow("t1", RECENT_MS), summaryRow("t2", RECENT_MS)],
      });

      const spanRead = await readTraces(["t1", "t2"]);

      expect(spanRead.query).toContain("t.StartTime >=");
      expect(spanRead.query).toContain("StartTime <=");
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      expect(spanRead.query_params.fromMs).toBe(RECENT_MS - twoDaysMs);
      expect(spanRead.query_params.toMs).toBe(RECENT_MS + twoDaysMs);
    });
  });

  describe("when no summary on the page carries a usable filing time", () => {
    /** @scenario "A page whose summaries carry no usable filing time still reads spans within a bounded window" */
    it("falls back to a retention floor rather than dropping the time predicate", async () => {
      // Pre-anchor sentinel rows: OccurredAt is the epoch, and the light resolve
      // (which now excludes sentinels in SQL) finds nothing to bound with.
      mockReads({
        resolved: { fromMs: null, toMs: null },
        summaries: [summaryRow("t1", 0), summaryRow("t2", 0)],
      });

      const spanRead = await readTraces(["t1", "t2"]);

      expect(spanRead.query).toContain("t.StartTime >=");
      expect(spanRead.query).toContain("StartTime <=");
      const fromMs = Number(spanRead.query_params.fromMs);
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(fromMs).toBeGreaterThan(0);
      // The floor is `now - 90d`, and `now` is read when the query runs rather
      // than when this module loaded, so compare with a minute of slack.
      expect(Math.abs(NOW - ninetyDaysMs - fromMs)).toBeLessThan(60_000);
      expect(Number(spanRead.query_params.toMs)).toBeGreaterThanOrEqual(NOW);
    });
  });

  describe("when one summary on the page carries no usable filing time", () => {
    /** @scenario "One trace with no usable filing time does not unbound the whole page" */
    it("bounds the span read by the times the other traces supply", async () => {
      mockReads({
        resolved: { fromMs: RECENT_MS, toMs: RECENT_MS },
        summaries: [summaryRow("t1", 0), summaryRow("t2", RECENT_MS)],
      });

      const spanRead = await readTraces(["t1", "t2"]);

      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      expect(spanRead.query_params.fromMs).toBe(RECENT_MS - twoDaysMs);
      expect(spanRead.query_params.toMs).toBe(RECENT_MS + twoDaysMs);
    });
  });
});

describe("given the light resolve that bounds a hint-less batch read", () => {
  it("excludes the epoch sentinel so one such row cannot collapse the range", async () => {
    mockReads({
      resolved: { fromMs: RECENT_MS, toMs: RECENT_MS },
      summaries: [summaryRow("t1", RECENT_MS)],
    });

    await readTraces(["t1"]);

    const resolveCall = mockClickHouseQuery.mock.calls.find(([args]) =>
      String(args.query).includes("AS fromMs"),
    );
    expect(resolveCall).toBeDefined();
    expect(String(resolveCall![0].query)).toContain(
      "OccurredAt > fromUnixTimestamp64Milli(0)",
    );
  });
});
