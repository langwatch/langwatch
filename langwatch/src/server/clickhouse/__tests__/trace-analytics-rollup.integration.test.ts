/**
 * Integration tests for the `trace_analytics_rollup` AggregatingMergeTree
 * (ADR-034 Phase 1), exercised against a real ClickHouse testcontainer on the
 * production schema (migration 00038 auto-applies through goose in
 * `startTestContainers`).
 *
 * Phase 1 removed the materialized view (an interim materialized-view migration that was never deployed) and
 * replaced it with an app-side projection (`TraceAnalyticsRollupMapProjection`)
 * that observes the same SpanReceivedEvent the trace-summary fold consumes and
 * writes one row per span via `TraceAnalyticsRollupClickHouseRepository`. These
 * tests drive that repository directly with rows shaped identically to what the
 * projection produces, so they exercise:
 *   - the table's `SimpleAggregateFunction(sum, ...)` semantics under merge,
 *   - the multitenancy boundary on TenantId,
 *   - the per-span re-delivery over-count contract (ADR-034 accepts it),
 *   - and the repository's JSONEachRow serialization shape.
 *
 * Reads use plain `sum(...)` over `SimpleAggregateFunction(sum, ...)` columns
 * — no `*Merge` combinator needed, since rows are inserted as raw scalars.
 *
 * Maps to specs/analytics/event-sourced-analytics-materialization.feature
 * (Rule: "The rollup sums additive metrics correctly from per-span increments"
 * and Rule: "A re-delivered span is tolerated, not corrected").
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TraceAnalyticsRollupClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics-rollup.clickhouse.repository";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { TraceAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";

const tenantId = `test-rollup-${generate("tenant").toString()}`;
// All spans below land in one minute bucket so the rollup collapses to a
// single (TenantId, BucketStart, Model, SpanType) group per distinct dim pair.
// Minute-aligned "yesterday", never a fixed calendar date: inserts are stamped
// with PLATFORM_DEFAULT_RETENTION_DAYS (49) and the table TTL-deletes rows
// `_retention_days` after BucketStart, so a fixed date eventually ages past
// the horizon and the fixtures silently vanish before the reads.
const baseMs = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 60_000) * 60_000;
const bucketStart = new Date(baseMs);

let ch: ClickHouseClient;
let repo: TraceAnalyticsRollupClickHouseRepository;

interface SpanFixture {
  /** Per-span cost contributed to the rollup. */
  cost: number;
  /** Bundled-portion cost (defaults to 0). */
  nonBilledCost?: number;
  /** Root-span carries duration; children pass 0 (matches projection logic). */
  durationMs?: number;
  /** Root span (contributes TraceCount 1). Defaults false — a child span. */
  isRoot?: boolean;
  /** 1 = error root, 0 otherwise. Pre-computed (projection gates on root+ERROR). */
  errorCount?: 0 | 1;
}

/**
 * Build a rollup row shaped exactly like `TraceAnalyticsRollupMapProjection`
 * would emit for a span with the given fixture values. Defaults model / spanType
 * to '' so the (TenantId, BucketStart, Model, SpanType) tuple collapses to a
 * single group per test, the way the prior MV would over a same-bucket trace.
 */
function makeRow(
  tenant: string,
  fixture: SpanFixture,
): TraceAnalyticsRollupRow {
  return {
    tenantId: tenant,
    bucketStart,
    model: "",
    spanType: "",
    spanCount: 1,
    traceCount: fixture.isRoot ? 1 : 0,
    errorCount: fixture.errorCount ?? 0,
    costSum: fixture.cost,
    nonBilledCostSum: fixture.nonBilledCost ?? 0,
    durationSum: fixture.durationMs ?? 0,
    promptTokensSum: 0,
    completionTokensSum: 0,
    cacheReadTokensSum: 0,
    cacheWriteTokensSum: 0,
    reasoningTokensSum: 0,
  };
}

/**
 * Read the merged rollup aggregates for a tenant via plain `sum()` —
 * `SimpleAggregateFunction(sum, ...)` columns merge transparently under regular
 * aggregations, so no `*Merge` combinator is required. TenantId is the first
 * (and here only) predicate — the multitenancy boundary — and each test isolates
 * its rows under its own tenant + bucket.
 */
async function readRollupForTenant(tenant: string): Promise<{
  costSum: number;
  spanCount: number;
  traceCount: number;
  durationSum: number;
  errorCount: number;
}> {
  // Async-inserted rows are intermittently not yet visible to the first
  // read even with wait_for_async_insert=1 (observed both in CI and
  // locally, independent of any code change). Every fixture row carries
  // SpanCount 1, so an empty or zero-span read can only mean the parts
  // are not queryable yet: retry briefly instead of asserting on a
  // pre-visibility snapshot. The assertions still verify the SUMS, which
  // is the contract under test.
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await ch.query({
      query: `
        SELECT
          sum(CostSum) AS costSum,
          sum(SpanCount) AS spanCount,
          sum(TraceCount) AS traceCount,
          sum(DurationSum) AS durationSum,
          sum(ErrorCount) AS errorCount
        FROM trace_analytics_rollup
        WHERE TenantId = {tenantId:String}
        GROUP BY TenantId, BucketStart, Model, SpanType
      `,
      query_params: { tenantId: tenant },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<
      Record<string, number | string>
    >;
    // The fixtures land in one (Model, SpanType) group so we get exactly one row.
    const row = rows[0] ?? {};
    const read = {
      costSum: Number(row.costSum ?? 0),
      spanCount: Number(row.spanCount ?? 0),
      traceCount: Number(row.traceCount ?? 0),
      durationSum: Number(row.durationSum ?? 0),
      errorCount: Number(row.errorCount ?? 0),
    };
    if (read.spanCount > 0 || Date.now() >= deadline) return read;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new TraceAnalyticsRollupClickHouseRepository(async () => ch);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("trace_analytics_rollup app-side projection (integration)", () => {
  describe("given three spans of one trace each contributing cost 0.01, 0.04, 0.05", () => {
    beforeAll(async () => {
      await repo.insertRows([
        makeRow(tenantId, { cost: 0.01 }),
        makeRow(tenantId, { cost: 0.04 }),
        makeRow(tenantId, { cost: 0.05 }),
      ]);
    });

    describe("when each span contributes its own cost as a SimpleAggregateFunction(sum) row", () => {
      it("sums the bucket cost to 0.10", async () => {
        const rollup = await readRollupForTenant(tenantId);
        expect(rollup.costSum).toBeCloseTo(0.1, 6);
      });

      it("counts three spans from three inserts", async () => {
        const rollup = await readRollupForTenant(tenantId);
        expect(rollup.spanCount).toBe(3);
      });
    });
  });
});

describe("trace_analytics_rollup root-span duration (integration)", () => {
  const rootTenantId = `test-rollup-dur-${generate("tenant").toString()}`;
  let durRepo: TraceAnalyticsRollupClickHouseRepository;

  beforeAll(async () => {
    durRepo = new TraceAnalyticsRollupClickHouseRepository(async () => ch);
    // Only the root span carries the trace's wall-clock duration; the two
    // children carry 0 — same gate the projection applies via `parentSpanId === null`.
    await durRepo.insertRows([
      makeRow(rootTenantId, { cost: 0, durationMs: 900, isRoot: true }),
      makeRow(rootTenantId, { cost: 0, durationMs: 0 }),
      makeRow(rootTenantId, { cost: 0, durationMs: 0 }),
    ]);
  });

  afterAll(async () => {
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: rootTenantId },
    });
  });

  describe("when only the root span carries DurationSum", () => {
    it("sums DurationSum to the root duration, ignoring the children", async () => {
      const rollup = await readRollupForTenant(rootTenantId);
      expect(rollup.durationSum).toBe(900);
    });

    it("counts exactly one trace via TraceCount (1 per root span)", async () => {
      const rollup = await readRollupForTenant(rootTenantId);
      expect(rollup.traceCount).toBe(1);
    });
  });
});

describe("trace_analytics_rollup per-trace average via TraceCount (integration)", () => {
  const avgTenantId = `test-rollup-avg-${generate("tenant").toString()}`;
  let avgRepo: TraceAnalyticsRollupClickHouseRepository;

  beforeAll(async () => {
    avgRepo = new TraceAnalyticsRollupClickHouseRepository(async () => ch);
    // Two traces in the bucket: roots carrying 900ms and 300ms, plus a child
    // span. TraceCount (1 per root) is the denominator that turns the
    // duration sum into a per-trace mean — the shape the rollup query builder
    // emits for avg(performance.completion_time).
    await avgRepo.insertRows([
      makeRow(avgTenantId, { cost: 0, durationMs: 900, isRoot: true }),
      makeRow(avgTenantId, { cost: 0, durationMs: 300, isRoot: true }),
      makeRow(avgTenantId, { cost: 0, durationMs: 0 }),
    ]);
  });

  afterAll(async () => {
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: avgTenantId },
    });
  });

  describe("when duration sums are divided by the trace count", () => {
    it("yields the per-trace average duration", async () => {
      const result = await ch.query({
        query: `
          SELECT sum(DurationSum) / nullIf(sum(TraceCount), 0) AS avgDuration
          FROM trace_analytics_rollup
          WHERE TenantId = {tenantId:String}
        `,
        query_params: { tenantId: avgTenantId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ avgDuration: number }>;
      expect(Number(rows[0]?.avgDuration)).toBe(600);
    });
  });
});

describe("trace_analytics_rollup re-delivered span (integration)", () => {
  const dupTenantId = `test-rollup-dup-${generate("tenant").toString()}`;
  let dupRepo: TraceAnalyticsRollupClickHouseRepository;

  beforeAll(async () => {
    dupRepo = new TraceAnalyticsRollupClickHouseRepository(async () => ch);
    const row = makeRow(dupTenantId, { cost: 0.02 });
    // First delivery, then a transient-failure re-delivery of the same span.
    // Each `insertRows` writes a fresh AggregatingMergeTree row, so the
    // bucket's sum is over-counted by that span's cost. ADR-034 tolerates this
    // — no back-out, no signs, no settle.
    await dupRepo.insertRows([row]);
    await dupRepo.insertRows([row]);
  });

  afterAll(async () => {
    await ch.exec({
      query:
        "ALTER TABLE trace_analytics_rollup DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: dupTenantId },
    });
  });

  describe("when the same span's increment is appended a second time", () => {
    it("over-counts the bucket by that span's cost, without backing it out", async () => {
      const rollup = await readRollupForTenant(dupTenantId);
      // 0.02 delivered twice → 0.04, tolerated (not deduped to 0.02).
      expect(rollup.costSum).toBeCloseTo(0.04, 6);
    });
  });
});
