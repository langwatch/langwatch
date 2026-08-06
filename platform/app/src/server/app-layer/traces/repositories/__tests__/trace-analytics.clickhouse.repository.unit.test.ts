/**
 * @vitest-environment node
 *
 * DateTime64 decode is timezone-safe.
 *
 * ClickHouse emits DateTime64(3) without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time, so
 * `new Date(str)` silently skews every timestamp by the host's UTC offset.
 * That matters more here than in a display path: `occurredAt` is folded with
 * `Math.min` against each new span, so a value read back early WINS and is
 * written straight back — the drift compounds on every cache miss instead of
 * cancelling, and `OccurredAt` is the table's partition key, ORDER BY column
 * and TTL anchor.
 *
 * CI runs in UTC, where the broken and correct parses agree, so this suite
 * forces a non-UTC zone before importing anything that touches Date. Kolkata
 * is deliberate: its +05:30 offset also catches a parse that happens to align
 * on whole hours.
 */
// Through node:process, NOT the global. Under a vm pool with isolate:false a
// worker reuses one context across files, and the `process` global vitest
// hands that context wraps the real one — assigning TZ on it misses Node's
// native env setter, which is the thing that flushes V8's cached timezone.
// So whenever another file had already used Date in this worker, the
// assignment silently did nothing, the guard below collapsed to "expected +0
// not to be +0", and which files shared a worker depended on the sequencer —
// a per-shard coin flip. node:process is the real object; its setter flushes
// the cache even mid-context. Verified against a deterministic repro
// (TZ=UTC, one worker, a Date-using suite loaded first).
import { env as nodeProcessEnv } from "node:process";

nodeProcessEnv.TZ = "Asia/Kolkata";

import { describe, expect, it } from "vitest";
import type { TraceAnalyticsRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import {
  capturingInsertClient,
  clientReturning,
  orderingClient,
  windowedReadCount,
} from "../../../analytics/__tests__/clickhouse-repository-test-helpers";
import { TraceAnalyticsClickHouseRepository } from "../trace-analytics.clickhouse.repository";

const TENANT_ID = "project_analyticsreadbackunit";
const TRACE_ID = "trace-tz";
const TABLE = "trace_analytics";

function makeRepositoryReturning(record: Record<string, unknown>) {
  return new TraceAnalyticsClickHouseRepository(async () =>
    clientReturning(record),
  );
}

function makeOrderingRepository(rows: Array<Record<string, unknown>>) {
  const { client, seen } = orderingClient(rows);
  return {
    repository: new TraceAnalyticsClickHouseRepository(async () => client),
    seen,
  };
}

/** A committed version of one trace, with the fold-progress columns spelled out. */
function tiedVersion({
  lastEventOccurredAt,
  spanCount,
  appliedEventIds,
  occurredAt,
}: {
  lastEventOccurredAt: string;
  spanCount: number;
  appliedEventIds: string[];
  occurredAt: string;
}): Record<string, unknown> {
  return {
    TenantId: TENANT_ID,
    TraceId: TRACE_ID,
    Version: "v1",
    // Both versions carry the SAME UpdatedAt: the premise of the whole suite is
    // that they tie, so both satisfy the IN-tuple dedup.
    UpdatedAt: "2026-07-24 12:00:02.500",
    CreatedAt: "2026-07-24 12:00:01.000",
    OccurredAt: occurredAt,
    LastEventOccurredAt: lastEventOccurredAt,
    SpanCount: spanCount,
    AppliedEventIds: appliedEventIds,
  };
}

describe("TraceAnalyticsClickHouseRepository DateTime64 decode", () => {
  describe("given a row whose DateTime64 columns carry no timezone suffix", () => {
    describe("when it is read back on a host that is not on UTC", () => {
      it("decodes them as UTC rather than the host's local time", async () => {
        // Guards the guard: if Node ever stops honouring a runtime TZ change,
        // this suite would pass vacuously under CI's UTC.
        expect(new Date().getTimezoneOffset()).not.toBe(0);

        const repository = makeRepositoryReturning({
          TenantId: TENANT_ID,
          TraceId: TRACE_ID,
          Version: "v1",
          OccurredAt: "2026-07-24 12:00:00.123",
          CreatedAt: "2026-07-24 12:00:01.000",
          UpdatedAt: "2026-07-24 12:00:02.500",
        });

        const read = await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(read?.row.occurredAtMs).toBe(
          Date.UTC(2026, 6, 24, 12, 0, 0, 123),
        );
        expect(read?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
        expect(read?.row.updatedAtMs).toBe(
          Date.UTC(2026, 6, 24, 12, 0, 2, 500),
        );
      });
    });
  });
});

/**
 * Two physical versions of one trace can tie on UpdatedAt: the fold stamps
 * `max(Date.now(), prev + 1)`, monotonic only within one state chain, so two
 * writers resuming from the same committed version land on the same ms. Both
 * then satisfy the IN-tuple dedup, and a bare LIMIT 1 picks arbitrarily —
 * resuming the fold from stale state that it rewrites, dropping the other
 * version's contributions and its applied-id watermark.
 */
describe("TraceAnalyticsClickHouseRepository tied-version read", () => {
  describe("given two committed versions of a trace that tie on UpdatedAt", () => {
    describe("when the stale version is the one ClickHouse would reach first", () => {
      it("returns the version that folded the latest event", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 3,
            appliedEventIds: ["a", "b"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
          tiedVersion({
            lastEventOccurredAt: "1750000009999",
            spanCount: 7,
            appliedEventIds: ["a", "b", "c", "d"],
            // The winner's OccurredAt is EARLIER: it is min(span start), which
            // only decreases as earlier spans land late.
            occurredAt: "2026-07-24 11:59:59.000",
          }),
        ]);

        const read = await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(read?.row.lastEventOccurredAt).toBe(1750000009999);
        expect(read?.row.spanCount).toBe(7);
        expect(read?.appliedEventIds).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when they also share the latest folded event time", () => {
      it("returns the version with more of the trace folded in", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 2,
            appliedEventIds: ["a"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 9,
            appliedEventIds: ["a", "b", "c"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
        ]);

        const read = await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(read?.row.spanCount).toBe(9);
        expect(read?.appliedEventIds).toEqual(["a", "b", "c"]);
      });
    });

    describe("when the keys disagree about which version is further along", () => {
      it("ranks by the latest folded event before any other key", async () => {
        // Every other fixture in this suite moves all four keys the same way,
        // so a collapsed ORDER BY — one that dropped LastEventOccurredAt, or
        // promoted OccurredAt ASC to first — still passes them. Here the keys
        // point at DIFFERENT rows, which is the only shape that pins the
        // priority the query's docstring argues for.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 12,
            appliedEventIds: ["a", "b", "c", "d", "e"],
            occurredAt: "2026-07-24 11:00:00.000",
          }),
          tiedVersion({
            // Further along by the only key that measures fold progress...
            lastEventOccurredAt: "1750000009999",
            // ...and behind on every key that does not.
            spanCount: 1,
            appliedEventIds: ["z"],
            occurredAt: "2026-07-24 13:00:00.000",
          }),
        ]);

        const read = await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(read?.row.lastEventOccurredAt).toBe(1750000009999);
        expect(read?.appliedEventIds).toEqual(["z"]);
      });
    });
  });
});

describe("TraceAnalyticsClickHouseRepository windowed read", () => {
  describe("given a caller-supplied window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as a window hit", async () => {
        const before = await windowedReadCount({
          table: TABLE,
          outcome: "hit",
        });
        // A row, so this is a genuine hit. The empty case is its own outcome
        // (see below) — asserting `hit` off an empty read would pin the wrong
        // half of the contract.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000001",
            spanCount: 1,
            appliedEventIds: ["a"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
        ]);

        await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(await windowedReadCount({ table: TABLE, outcome: "hit" })).toBe(
          before + 1,
        );
      });

      /**
       * This read declares its window authoritative, so a miss never widens and
       * has no widen outcome to appear as. It gets counted as a miss instead of
       * folded into `hit`.
       */
      /** @scenario a bounded miss is recorded as a miss, not as an answer */
      it("counts an empty window as a miss, not as a hit", async () => {
        const beforeEmpty = await windowedReadCount({
          table: TABLE,
          outcome: "windowed_empty",
        });
        const beforeHit = await windowedReadCount({
          table: TABLE,
          outcome: "hit",
        });
        const { repository } = makeOrderingRepository([]);

        await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(
          await windowedReadCount({ table: TABLE, outcome: "windowed_empty" }),
        ).toBe(beforeEmpty + 1);
        expect(await windowedReadCount({ table: TABLE, outcome: "hit" })).toBe(
          beforeHit,
        );
      });

      it("passes the caller's bounds through to ClickHouse unchanged", async () => {
        // queryWindowed takes a centre + half-width, so the bounds make a
        // round-trip through `(from + to) / 2` and `(to - from) / 2`. An odd
        // width lands the halves on .5 and still has to reconstruct exactly.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(seen[0]?.query_params?.from).toBe(1_750_000_000_000);
        expect(seen[0]?.query_params?.to).toBe(1_750_000_345_679);
      });

      it("bounds the outer scope only, leaving the dedup subquery unwindowed", async () => {
        // Windowing the inner scope too would let a trace whose latest version
        // drifted out of the window read back as a stale in-window version — a
        // non-null answer no fallback can catch.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        const query = seen[0]?.query ?? "";
        const innerScopeStart = query.indexOf("IN (");
        const outerScope = query.slice(0, innerScopeStart);
        const innerScope = query.slice(
          innerScopeStart,
          query.indexOf("GROUP BY"),
        );

        expect(outerScope).toContain("fromUnixTimestamp64Milli");
        expect(innerScope).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });

  describe("given no window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as unwindowed", async () => {
        const before = await windowedReadCount({
          table: TABLE,
          outcome: "unwindowed",
        });
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(
          await windowedReadCount({ table: TABLE, outcome: "unwindowed" }),
        ).toBe(before + 1);
        expect(seen[0]?.query).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });
});

/**
 * The write half of the migration window (ADR-066).
 *
 * `wrapWithDefaultSettings` proxies only `.query`, so an insert carries exactly
 * the settings the repository passes and nothing else. ClickHouse defaults
 * `input_format_skip_unknown_fields` ON, and the workers Deployment overrides
 * the entrypoint so it never runs migrations — they run in the app pod's boot,
 * and the two roll concurrently. Without the explicit 0, a worker writing before
 * migration 00056 applies gets HTTP 200 with the new columns dropped and the row
 * stamped at the CURRENT projection version, so it later passes the store's
 * version gate and decodes as all-defaults with no rebuild path.
 */
describe("TraceAnalyticsClickHouseRepository insert settings", () => {
  const ROW: TraceAnalyticsRow = {
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    version: "2026-07-27",
    hasSignal: true,
    occurredAtMs: 1_750_000_000_000,
    createdAtMs: 1_750_000_000_000,
    updatedAtMs: 1_750_000_000_000,
    traceName: "t",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "playground",
    models: [],
    labels: [],
    totalCost: null,
    nonBilledCost: null,
    totalDurationMs: 0,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
    spanCount: 1,
    annotationIds: [],
    rootSpanStartTimeMs: 0,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    traceNameUserOverridden: false,
    lastEventOccurredAt: 1_750_000_000_000,
    earliestSpanStartMs: 1_750_000_000_000,
  };

  describe("given a table that predates the row's columns", () => {
    describe("when a single row is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = new TraceAnalyticsClickHouseRepository(
          async () => client,
        );

        await repository.upsert(ROW);

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });

    describe("when a batch is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = new TraceAnalyticsClickHouseRepository(
          async () => client,
        );

        await repository.upsertBatch([{ row: ROW }]);

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });
  });
});
