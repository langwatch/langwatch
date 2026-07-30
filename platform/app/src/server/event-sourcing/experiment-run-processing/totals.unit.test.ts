import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { deriveExperimentRunTotals } from "./totals";

/** Matches `totals.ts`'s private `SUMMARY_COLUMN_NAMES` order. */
function summaryRow(values: {
  completedCount: number;
  failedCount: number;
  durationSumMs: number;
  durationCount: number;
  scoreSumBps: number;
  scoreCount: number;
  gradedCount: number;
  passedCount: number;
  totalDirectCost: number;
}): unknown[] {
  return [
    String(values.completedCount),
    String(values.failedCount),
    String(values.durationSumMs),
    String(values.durationCount),
    String(values.scoreSumBps),
    String(values.scoreCount),
    String(values.gradedCount),
    String(values.passedCount),
    values.totalDirectCost,
  ];
}

const HEADER = {
  names: [
    "completedCount",
    "failedCount",
    "durationSumMs",
    "durationCount",
    "scoreSumBps",
    "scoreCount",
    "gradedCount",
    "passedCount",
    "totalDirectCost",
  ],
  types: [
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "UInt64",
    "Float64",
  ],
};

function createFakeClient(
  rows: unknown[][],
): ClickHouseClient & { readonly queryCalls: QueryOptions[] } {
  const queryCalls: QueryOptions[] = [];
  return {
    queryCalls,
    async query(options) {
      queryCalls.push(options);
      return { rows, header: HEADER };
    },
    stream(): AsyncIterable<unknown[][]> {
      throw new Error("not used by this query");
    },
    async insert() {
      throw new Error("not used by this query");
    },
    async close() {
      // Not exercised by a read-only query — nothing to release.
    },
  };
}

/** Substitutes each bound `Identifier` back in, so a shape is readable. */
function readable(call: QueryOptions): string {
  return call.sql.replace(
    /\{(id\d+):Identifier\}/g,
    (_match, key: string) => String((call.params as Record<string, unknown>)[key]),
  );
}

describe("deriveExperimentRunTotals", () => {
  describe("given a run with no items", () => {
    it("reports zero counts and null rates rather than throwing", async () => {
      const client = createFakeClient([]);

      const totals = await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      expect(totals).toEqual({
        completedCount: 0,
        failedCount: 0,
        progress: 0,
        totalDurationMs: null,
        avgScoreBps: null,
        passRateBps: null,
        scoreCount: 0,
        gradedCount: 0,
        passedCount: 0,
        totalDirectCost: 0,
      });
    });
  });

  describe("given a run whose items have partly completed", () => {
    /** @scenario "Progress and outcomes reflect the run's items" */
    it("derives progress, outcomes, duration, average score and pass rate from one summary row", async () => {
      const client = createFakeClient([
        summaryRow({
          completedCount: 3,
          failedCount: 1,
          durationSumMs: 4_000,
          durationCount: 4,
          scoreSumBps: 27_000, // 0.9 + 0.8 + 1.0, each * 10000, summed
          scoreCount: 3,
          gradedCount: 3,
          passedCount: 2,
          totalDirectCost: 1.23,
        }),
      ]);

      const totals = await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      expect(totals.completedCount).toBe(3);
      expect(totals.failedCount).toBe(1);
      expect(totals.progress).toBe(4);
      expect(totals.totalDurationMs).toBe(4_000);
      expect(totals.avgScoreBps).toBe(9_000); // 27000 / 3
      expect(totals.passRateBps).toBeCloseTo(6_667, 0); // round(2/3 * 10000)
      expect(totals.totalDirectCost).toBeCloseTo(1.23, 5);
    });

    it("reports totalDurationMs as null when no item carried a duration, distinct from a total of 0", async () => {
      const client = createFakeClient([
        summaryRow({
          completedCount: 1,
          failedCount: 0,
          durationSumMs: 0,
          durationCount: 0,
          scoreSumBps: 0,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
      ]);

      const totals = await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      expect(totals.totalDurationMs).toBeNull();
      expect(totals.avgScoreBps).toBeNull();
      expect(totals.passRateBps).toBeNull();
    });
  });

  describe("given a run that already reads as finished", () => {
    /** @scenario "A late item changes the run immediately" */
    it("reflects a straggling item on the very next call — there is no cache to go stale", async () => {
      // `deriveExperimentRunTotals` holds no state of its own between calls,
      // so the fixture models "before" and "after" as two independent
      // queries against the item rows — exactly what a real caller does: it
      // never proactively pushes an update, it just re-reads.
      const before = createFakeClient([
        summaryRow({
          completedCount: 9,
          failedCount: 0,
          durationSumMs: 9_000,
          durationCount: 9,
          scoreSumBps: 0,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
      ]);
      const beforeTotals = await deriveExperimentRunTotals({
        client: before,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });
      expect(beforeTotals.completedCount).toBe(9);

      // A further item result is recorded for the run between the two reads.
      const after = createFakeClient([
        summaryRow({
          completedCount: 10,
          failedCount: 0,
          durationSumMs: 10_000,
          durationCount: 10,
          scoreSumBps: 0,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
      ]);
      const afterTotals = await deriveExperimentRunTotals({
        client: after,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });
      expect(afterTotals.completedCount).toBe(10);
    });
  });

  describe("query shape", () => {
    it("always scopes by TenantId, RunId and ExperimentId", async () => {
      const client = createFakeClient([]);

      await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      const call = client.queryCalls[0]!;
      expect(call.params).toMatchObject({
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });
      expect(call.sql).not.toContain("experiment_run_items");
      expect(readable(call)).toContain("TenantId = {tenantId:String}");
    });

    /** @scenario "A repeated item result does not inflate the run" */
    it("dedups redelivered item rows via an IN-tuple subquery, per dev/docs/best_practices/clickhouse-queries.md", async () => {
      const client = createFakeClient([]);

      await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      const sql = readable(client.queryCalls[0]!);
      expect(sql).toContain("GROUP BY TenantId, RunId, ProjectionId");
      expect(sql).toMatch(/IN \(/);
    });

    it("adds the occurredAt bound to the outer scope only, never the inner dedup scope", async () => {
      const client = createFakeClient([]);

      await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
        occurredAtRange: {
          from: new Date("2026-01-01T00:00:00Z"),
          to: new Date("2026-01-08T00:00:00Z"),
        },
      });

      const sql = readable(client.queryCalls[0]!);
      const innerSubquery = sql.slice(sql.indexOf("IN ("));
      expect(sql).toContain("t.OccurredAt >= {occurredAtFrom:DateTime64(3)}");
      expect(innerSubquery).not.toContain("occurredAtFrom");
    });

    it("omits the occurredAt bound entirely when no range is supplied", async () => {
      const client = createFakeClient([]);

      await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runId: "run-1",
        experimentId: "exp-1",
      });

      expect(client.queryCalls[0]!.sql).not.toContain("occurredAtFrom");
      expect(client.queryCalls[0]!.params).not.toHaveProperty("occurredAtFrom");
    });
  });
});
