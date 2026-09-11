// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Regression test for langwatch/langwatch#8072 steps 2 and 3.
 *
 * Every spend read in this repository filters `OccurredAt` with a floor and
 * no ceiling.
 *
 * The ceiling is NOT here for partition pruning. `trace_summaries` is
 * `PARTITION BY toYearWeek(OccurredAt)` (migrations/00002_create_schema.sql:179)
 * and the existing floor already prunes the old side; bounding the top at
 * `now` prunes little, because few or no partitions sit above `now` — the
 * clock-skew rows in (2) below being the exception, and exactly the data the
 * bound removes. The ceiling is here for two other reasons:
 *
 *   1. Determinism. An open-ended read answers differently on every call, so
 *      its result cannot be cached under a stable key. A closed range is the
 *      prerequisite for the caching work in #8072 step 1, which is deferred.
 *   2. Clock skew. Rows landing with `OccurredAt` in the future are counted
 *      today and should not be.
 *
 * The bound goes into the inner dedup subquery as well as the outer query
 * because the two halves are filtered independently — see the same
 * both-halves treatment in aggregation-builder.ts:137.
 *
 * These reads previously carried no ClickHouse settings, so a single wide scan
 * had no ceiling on threads or runtime. Storage metering already pinned both
 * (storageMeter.service.ts:63-67).
 *
 * Each test drives the real repository through its production constructor
 * contract with a mock client, then asserts on the SQL that was actually
 * handed to ClickHouse.
 */
import { describe, expect, it, vi } from "vitest";

import { ActivityMonitorSpendClickHouseRepository } from "../activityMonitor.spend.clickhouse.repository";

function makeRepo() {
  const query = vi.fn(async () => ({
    json: async () => [] as unknown[],
  }));
  const ch = { query } as never;
  const repo = new ActivityMonitorSpendClickHouseRepository(async () => ch);
  return { repo, query };
}

type CapturedCall = {
  query: string;
  query_params: Record<string, unknown>;
  clickhouse_settings?: Record<string, unknown>;
};

function captured(query: { mock: { calls: unknown[][] } }): CapturedCall {
  const first = query.mock.calls[0]?.[0];
  return first as CapturedCall;
}

const WINDOW_START = Date.UTC(2026, 0, 1);
const WINDOW_END = Date.UTC(2026, 1, 1);

/**
 * Each entry drives one read to completion and hands back the SQL it sent.
 * Keeping them in one table means a sixth read added later without a bound
 * fails here rather than shipping unbounded.
 */
const READS: Array<{
  name: string;
  run: (repo: ActivityMonitorSpendClickHouseRepository) => Promise<unknown>;
}> = [
  {
    name: "findSummarySpend",
    run: (repo) =>
      repo.findSummarySpend({
        tenantId: "tenant-a",
        thisStart: WINDOW_START,
        prevStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
  },
  {
    name: "findSpendByUser",
    run: (repo) =>
      repo.findSpendByUser({
        tenantId: "tenant-a",
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        sortBy: "spend",
        sortDir: "desc",
        limit: 8,
        offset: 0,
      }),
  },
  {
    name: "findSpendByDepartment",
    run: (repo) =>
      repo.findSpendByDepartment({
        tenantIds: ["tenant-a", "tenant-b"],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
  },
  {
    name: "findSpendByTeamSource",
    run: (repo) =>
      repo.findSpendByTeamSource({
        tenantId: "tenant-a",
        thisStart: WINDOW_START,
        prevStart: WINDOW_START,
        windowEnd: WINDOW_END,
      }),
  },
  {
    name: "findSpendOverTime",
    run: (repo) =>
      repo.findSpendOverTime({
        tenantId: "tenant-a",
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        groupBy: "team",
      }),
  },
];

describe("ActivityMonitorSpendClickHouseRepository query bounds", () => {
  describe("when a spend read is issued (#8072 step 2: open upper bound)", () => {
    for (const read of READS) {
      it(`${read.name} binds the upper end of the time range`, async () => {
        const { repo, query } = makeRepo();

        await read.run(repo);

        const call = captured(query);
        expect(call.query_params).toHaveProperty("windowEnd");
        expect(call.query_params.windowEnd).toBe(WINDOW_END);
      });

      it(`${read.name} pushes the upper bound into the dedup subquery too`, async () => {
        const { repo, query } = makeRepo();

        await read.run(repo);

        // Outer query and inner dedup subquery must BOTH carry the ceiling,
        // otherwise the subquery still scans every partition to the present
        // and the outer bound prunes nothing.
        const call = captured(query);
        const occurrences = call.query.match(/\{windowEnd:UInt64\}/g) ?? [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  describe("when a spend read is issued (#8072 step 3: no query ceiling)", () => {
    for (const read of READS) {
      it(`${read.name} caps execution time and thread count`, async () => {
        const { repo, query } = makeRepo();

        await read.run(repo);

        const call = captured(query);
        expect(call.clickhouse_settings).toBeDefined();
        expect(typeof call.clickhouse_settings?.max_execution_time).toBe(
          "number",
        );
        expect(typeof call.clickhouse_settings?.max_threads).toBe("number");
      });
    }
  });
});
