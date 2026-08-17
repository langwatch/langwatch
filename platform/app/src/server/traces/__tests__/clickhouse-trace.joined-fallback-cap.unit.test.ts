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

const mockClickHouseQuery = vi.hoisted(() => vi.fn());

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

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

function spanRow(traceId: string, spanIndex: number) {
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
 */
function clickHouseThatOOMsThenBatches({
  spansPerTrace,
}: {
  spansPerTrace: number;
}) {
  let refusedOnce = false;
  mockClickHouseQuery.mockImplementation(
    async (args: { query: string; query_params?: { traceIds?: string[] } }) => {
      const ids = args.query_params?.traceIds ?? [];
      if (args.query.includes("FROM stored_spans")) {
        if (!refusedOnce) {
          refusedOnce = true;
          throw new Error("Code: 241. DB::Exception: MEMORY_LIMIT_EXCEEDED");
        }
        return {
          json: async () =>
            ids.flatMap((id) =>
              Array.from({ length: spansPerTrace }, (_, i) => spanRow(id, i)),
            ),
        };
      }
      if (args.query.includes("trace_summaries")) {
        return { json: async () => ids.map(summaryRow) };
      }
      return { json: async () => [] };
    },
  );
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
      const service = new ClickHouseTraceService({} as never);

      const chain = await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(chain).toMatch(/exceeded 50000 spans/);
    });

    /** @scenario "The memory-limit fallback stops before it exhausts the heap" */
    it("names the traces it had already materialised", async () => {
      clickHouseThatOOMsThenBatches({ spansPerTrace: 200 });
      const service = new ClickHouseTraceService({} as never);

      const chain = await rejectionChain(
        service.getTracesWithSpans(PROJECT, traceIds(400), openProtections),
      );

      expect(chain).toMatch(/of 400 traces/);
    });
  });

  describe("given the batched retry fits under the cap", () => {
    /** @scenario "A fallback that fits under the cap still returns every trace" */
    it("returns every requested trace", async () => {
      clickHouseThatOOMsThenBatches({ spansPerTrace: 1 });
      const service = new ClickHouseTraceService({} as never);

      const traces = await service.getTracesWithSpans(
        PROJECT,
        traceIds(60),
        openProtections,
      );

      expect(traces).toHaveLength(60);
    });
  });
});
