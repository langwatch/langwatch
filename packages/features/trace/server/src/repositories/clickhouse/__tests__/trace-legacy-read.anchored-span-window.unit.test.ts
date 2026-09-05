/**
 * @see ADR-087
 * The joined span read must never emit an empty time predicate. fetchTracesWithSpansJoined derived its stored_spans window solely from matched summaries' OccurredAt, keeping only positive values — a page of log-only traces (epoch sentinel) left nothing, so queryWindowed got a null hint + fallback:"none" and BOTH time filters rendered empty, scanning every weekly part (cold S3 included) and dying with MEMORY_LIMIT_EXCEEDED (241). These assert on the SQL itself, since the defect IS the SQL.
 */
import { describe, expect, it, vi } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import type { Protections } from "@langwatch/trace-server";

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));
const traceCanonicalisation = TraceCanonicalisationService.create();

/**
 * The process's tenant-keyed connection, as this suite supplies it — arrives as a CONSTRUCTOR argument now. The suite used to mock the platform application's singleton; the repository takes the resolver instead, so the fake sits where every other dependency of the read does.
 */
const testResolveClickHouseClient = () => Promise.resolve({ query: mockClickHouseQuery } as never);

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
 * The three reads fetchTracesWithSpansJoined fires with no time range (light min/max resolve, summary read, span read), routed by query shape rather than call order, so a read gained/dropped upstream surfaces as an unmatched query, not a wrong payload two frames away. Every shape is matched explicitly and anything else throws — a default payload would hide exactly the break this routing exists to expose.
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
 * Drives the read and hands back the span query it issued. A missing span read is a broken fixture, not a failed expectation — these scenarios are all about the query's SHAPE, so throwing (rather than returning undefined) keeps assertions in the it blocks and reports a setup break as a setup break.
 */
async function readTraces(traceIds: string[]) {
  const { TraceLegacyReadClickHouseRepository } = await import("../trace-legacy-read.repository");
  const service = new TraceLegacyReadClickHouseRepository({
    resolveClickHouseClient: testResolveClickHouseClient,
    prisma: {
      project: { findUnique: vi.fn() },
    } as never,
    traceCanonicalisation,
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
    expect(String(resolveCall![0].query)).toContain("OccurredAt > fromUnixTimestamp64Milli(0)");
  });
});
