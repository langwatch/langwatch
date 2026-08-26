/**
 * @vitest-environment node
 *
 * The traces-with-spans memory-limit fallback must not exhaust the heap.
 *
 * On OOM the read is retried in batches of 25 and every batch merged into one
 * map, which bounds ClickHouse's peak memory and not ours — the same full
 * result set is rebuilt on this side of the socket. A 980-trace read did that
 * on every worker at once and produced 50 V8 heap deaths over six days.
 *
 * The read has already failed in ClickHouse before the fallback runs, so
 * refusing it costs the caller nothing it had; what it buys is that the failure
 * stays inside one job instead of taking the process.
 *
 * Spec: specs/clickhouse/bounded-reads.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceCanonicalisationService } from "@langwatch/trace-server";

const mockClickHouseQuery = vi.hoisted(() => vi.fn());

vi.mock("~/server/app-layer/app", () => {
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: () => Promise.resolve({ query: mockClickHouseQuery }),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (span: unknown) => unknown)({
        setAttribute: () => undefined,
        setAttributes: () => undefined,
        addEvent: () => undefined,
      });
    },
  }),
}));

const { ClickHouseTraceService } = await import("../clickhouse-trace.service");
const traceCanonicalisation = TraceCanonicalisationService.create();
const { openProtections } = await import("./open-protections");

const PROJECT = "project_joined_cap";

const OCCURRED_AT = Date.UTC(2026, 7, 17, 0, 0, 0);

function summaryRow(traceId: string) {
  return {
    ts_TraceId: traceId,
    ts_OccurredAt: OCCURRED_AT,
    ts_Attributes: {},
    ts_SpanCount: 1,
    ts_TotalDurationMs: 1,
    ts_ComputedIOSchemaVersion: 1,
    ts_ComputedInput: null,
    ts_ComputedOutput: null,
    ts_TimeToFirstTokenMs: null,
    ts_TimeToLastTokenMs: null,
    ts_TokensPerSecond: null,
  };
}

function spanRow({ traceId, spanIndex }: { traceId: string; spanIndex: number }) {
  return {
    SpanId: `${traceId}-span-${spanIndex}`,
    TraceId: traceId,
    TenantId: PROJECT,
    StartTime: OCCURRED_AT,
    EndTime: OCCURRED_AT + 1,
    DurationMs: 1,
    SpanName: "span",
    SpanKind: "INTERNAL",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: "",
    Events_Timestamp: [],
    Events_Name: [],
    Events_Attributes: [],
    Links_TraceId: [],
    Links_SpanId: [],
    Links_Attributes: [],
  };
}

/**
 * Refuses the first whole-list span read for memory — which is what triggers
 * the fallback — then serves each batched retry with `spansPerTrace` rows per
 * requested trace. Trace ids ride in query_params, not the SQL text.
 *
 * `max_result_rows` is honoured the way the server honours it, because that is
 * the behaviour under test: the fallback's whole point is that an over-budget
 * batch is refused BEFORE its rows are decoded, and a mock that hands back
 * every row regardless cannot tell that apart from a cap checked afterwards.
 * `spanRowsServed` records what actually crossed the socket, so a test can
 * assert the heap never saw the rows.
 */
function clickHouseThatOOMsThenBatches({ spansPerTrace }: { spansPerTrace: number }) {
  let refusedOnce = false;
  const spanReadSettings: Array<Record<string, unknown>> = [];
  const served = { spanRowsServed: 0 };

  mockClickHouseQuery.mockImplementation(
    async (args: {
      query: string;
      query_params?: { traceIds?: string[] };
      clickhouse_settings?: Record<string, unknown>;
    }) => {
      const ids = args.query_params?.traceIds ?? [];
      if (args.query.includes("FROM stored_spans")) {
        if (!refusedOnce) {
          refusedOnce = true;
          throw new Error("Code: 241. DB::Exception: MEMORY_LIMIT_EXCEEDED");
        }
        spanReadSettings.push(args.clickhouse_settings ?? {});

        const rowCount = ids.length * spansPerTrace;
        const maxResultRows = Number(
          args.clickhouse_settings?.max_result_rows ?? Number.POSITIVE_INFINITY,
        );
        if (
          args.clickhouse_settings?.result_overflow_mode === "throw" &&
          rowCount > maxResultRows
        ) {
          throw new Error(
            "Code: 396. DB::Exception: Limit for result exceeded: " +
              "TOO_MANY_ROWS_OR_BYTES",
          );
        }

        served.spanRowsServed += rowCount;
        return {
          json: async () =>
            ids.flatMap((traceId) =>
              Array.from({ length: spansPerTrace }, (_, spanIndex) =>
                spanRow({ traceId, spanIndex }),
              ),
            ),
        };
      }
      if (args.query.includes("trace_summaries")) {
        return { json: async () => ids.map(summaryRow) };
      }
      return { json: async () => [] };
    },
  );

  return { spanReadSettings, served };
}

/**
 * `getTracesWithSpans` wraps every failure in a generic message, so the reason
 * only survives on the cause chain.
 */
async function rejectionChain(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;
    while (current instanceof Error && parts.length < 6) {
      parts.push(current.message);
      current = current.cause;
    }
    return parts.join(" <- ");
  }
  throw new Error("expected the read to reject, but it resolved");
}

const traceIds = (n: number) =>
  Array.from({ length: n }, (_, i) => `trace_${String(i).padStart(6, "0")}`);

describe("the traces-with-spans memory-limit fallback", () => {
  beforeEach(() => {
    mockClickHouseQuery.mockReset();
  });

  describe("given the batched retry would outgrow the span cap", () => {
    /** @scenario "The memory-limit fallback stops before it exhausts the heap" */
    it("stops and reports how far it got, rather than filling the heap", async () => {
      // 400 traces x 200 spans = 80,000 spans, past the 50,000 cap.
      clickHouseThatOOMsThenBatches({ spansPerTrace: 200 });
      const service = new ClickHouseTraceService({
        prisma: {} as never,
        traceCanonicalisation,
      });

      const chain = await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(chain).toMatch(/exceeded 50000 spans/);
    });

    /** @scenario "The memory-limit fallback stops before it exhausts the heap" */
    it("names the traces it had already materialised", async () => {
      clickHouseThatOOMsThenBatches({ spansPerTrace: 200 });
      const service = new ClickHouseTraceService({
        prisma: {} as never,
        traceCanonicalisation,
      });

      const chain = await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(chain).toMatch(/of 400 traces/);
    });
  });

  describe("given a single batch alone would outgrow the span cap", () => {
    /**
     * The regression this guards: one batch is 25 traces at up to 10,000 spans
     * each — 250,000 heavy rows, five times the cap — and the cap used to be
     * checked only after `runBatch` had awaited `.json()` and built its maps.
     * The batch that was supposed to be refused was therefore materialised
     * first, which is the heap death the cap exists to prevent.
     */
    /** @scenario "A single over-budget batch is refused before it is materialised" */
    it("never lets the over-budget batch reach this process", async () => {
      // 25 traces per batch x 10,000 spans = 250,000 rows in the first batch.
      const { served } = clickHouseThatOOMsThenBatches({
        spansPerTrace: 10_000,
      });
      const service = new ClickHouseTraceService({
        prisma: {} as never,
        traceCanonicalisation,
      });

      const chain = await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(chain).toMatch(/exceeded 50000 spans/);
      expect(served.spanRowsServed).toBeLessThanOrEqual(50_000);
    });

    /** @scenario "A single over-budget batch is refused before it is materialised" */
    it("bounds the span read to the budget it has left", async () => {
      const { spanReadSettings } = clickHouseThatOOMsThenBatches({
        spansPerTrace: 10_000,
      });
      const service = new ClickHouseTraceService({
        prisma: {} as never,
        traceCanonicalisation,
      });

      await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(spanReadSettings[0]).toMatchObject({
        max_result_rows: String(50_000 + 1),
        result_overflow_mode: "throw",
      });
    });
  });

  describe("given the batched retry fits under the cap", () => {
    /** @scenario "A fallback that fits under the cap still returns every trace" */
    it("returns every requested trace", async () => {
      clickHouseThatOOMsThenBatches({ spansPerTrace: 1 });
      const service = new ClickHouseTraceService({
        prisma: {} as never,
        traceCanonicalisation,
      });

      const traces = await service.getTracesWithSpans(
        PROJECT,
        traceIds(60),
        openProtections,
      );

      expect(traces).toHaveLength(60);
    });
  });
});
