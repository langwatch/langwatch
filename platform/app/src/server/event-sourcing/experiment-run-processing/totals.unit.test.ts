import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import {
  deriveExperimentRunTotals,
  type ExperimentRunTotals,
  experimentRunTotalsKey,
} from "./totals";

/**
 * The wire forms ClickHouse's JSONCompact family actually emits for this
 * query's expressions: `countIf` is a `UInt64` and crosses as a decimal
 * string, a `sumIf` over a `Nullable` column is nullable and is `null` — not
 * `0` — when nothing matched, and a `Float64` crosses as a bare JSON number.
 */
function summaryRow(values: {
  experimentId?: string;
  runId?: string;
  completedCount: number;
  failedCount: number;
  durationSumMs: number | null;
  durationCount: number;
  scoreSumBps: number | null;
  scoreCount: number;
  gradedCount: number;
  passedCount: number;
  totalDirectCost: number;
}): unknown[] {
  return [
    values.experimentId ?? "exp-1",
    values.runId ?? "run-1",
    String(values.completedCount),
    String(values.failedCount),
    values.durationSumMs === null ? null : String(values.durationSumMs),
    String(values.durationCount),
    values.scoreSumBps,
    String(values.scoreCount),
    String(values.gradedCount),
    String(values.passedCount),
    values.totalDirectCost,
  ];
}

const HEADER = {
  names: [
    "experimentId",
    "runId",
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
    "String",
    "String",
    "UInt64",
    "UInt64",
    "Nullable(UInt64)",
    "UInt64",
    "Nullable(Float64)",
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
  return call.sql.replace(/\{(id\d+):Identifier\}/g, (_match, key: string) =>
    String((call.params as Record<string, unknown>)[key]),
  );
}

const ONE_RUN = [{ experimentId: "exp-1", runId: "run-1" }];

async function totalsFor(
  client: ClickHouseClient,
  runs = ONE_RUN,
): Promise<Map<string, ExperimentRunTotals>> {
  return deriveExperimentRunTotals({ client, tenantId: "tenant-1", runs });
}

describe("deriveExperimentRunTotals", () => {
  describe("given a run with no items", () => {
    it("leaves the run out of the map rather than publishing zeroes", async () => {
      const totals = await totalsFor(createFakeClient([]));

      expect(totals.size).toBe(0);
      expect(totals.get(experimentRunTotalsKey(ONE_RUN[0]!))).toBeUndefined();
    });
  });

  describe("given no runs at all", () => {
    it("does not query", async () => {
      const client = createFakeClient([]);
      await totalsFor(client, []);
      expect(client.queryCalls).toEqual([]);
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

      const totals = (await totalsFor(client)).get(
        experimentRunTotalsKey(ONE_RUN[0]!),
      )!;

      expect(totals.completedCount).toBe(3);
      expect(totals.failedCount).toBe(1);
      expect(totals.progress).toBe(4);
      expect(totals.totalDurationMs).toBe(4_000);
      expect(totals.avgScoreBps).toBe(9_000); // 27000 / 3
      expect(totals.passRateBps).toBeCloseTo(6_667, 0); // round(2/3 * 10000)
      expect(totals.totalDirectCost).toBeCloseTo(1.23, 5);
    });

    it("reads a graded score sum as the bare JSON number ClickHouse sends for a Float64", async () => {
      const client = createFakeClient([
        summaryRow({
          completedCount: 1,
          failedCount: 0,
          durationSumMs: null,
          durationCount: 0,
          scoreSumBps: 8_500,
          scoreCount: 1,
          gradedCount: 1,
          passedCount: 1,
          totalDirectCost: 0,
        }),
      ]);

      const totals = (await totalsFor(client)).get(
        experimentRunTotalsKey(ONE_RUN[0]!),
      )!;

      expect(totals.avgScoreBps).toBe(8_500);
    });

    it("reports totalDurationMs as null when no item carried a duration, distinct from a total of 0", async () => {
      const client = createFakeClient([
        summaryRow({
          completedCount: 1,
          failedCount: 0,
          durationSumMs: null,
          durationCount: 0,
          scoreSumBps: null,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
      ]);

      const totals = (await totalsFor(client)).get(
        experimentRunTotalsKey(ONE_RUN[0]!),
      )!;

      expect(totals.totalDurationMs).toBeNull();
      expect(totals.avgScoreBps).toBeNull();
      expect(totals.passRateBps).toBeNull();
    });
  });

  describe("given a page of runs, one of which reuses another's run id", () => {
    it("keys each run's totals by the experiment and the run together", async () => {
      const runs = [
        { experimentId: "exp-1", runId: "run-1" },
        { experimentId: "exp-2", runId: "run-1" },
      ];
      const client = createFakeClient([
        summaryRow({
          experimentId: "exp-1",
          completedCount: 3,
          failedCount: 0,
          durationSumMs: null,
          durationCount: 0,
          scoreSumBps: null,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
        summaryRow({
          experimentId: "exp-2",
          completedCount: 7,
          failedCount: 0,
          durationSumMs: null,
          durationCount: 0,
          scoreSumBps: null,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        }),
      ]);

      const totals = await totalsFor(client, runs);

      expect(totals.get(experimentRunTotalsKey(runs[0]!))?.progress).toBe(3);
      expect(totals.get(experimentRunTotalsKey(runs[1]!))?.progress).toBe(7);
      expect(client.queryCalls).toHaveLength(1);
    });
  });

  describe("given a run that already reads as finished", () => {
    /** @scenario "A late item changes the run immediately" */
    it("reflects a straggling item on the very next call — there is no cache to go stale", async () => {
      const rowWith = (completedCount: number) =>
        summaryRow({
          completedCount,
          failedCount: 0,
          durationSumMs: completedCount * 1_000,
          durationCount: completedCount,
          scoreSumBps: null,
          scoreCount: 0,
          gradedCount: 0,
          passedCount: 0,
          totalDirectCost: 0,
        });
      const key = experimentRunTotalsKey(ONE_RUN[0]!);

      const before = await totalsFor(createFakeClient([rowWith(9)]));
      expect(before.get(key)?.completedCount).toBe(9);

      const after = await totalsFor(createFakeClient([rowWith(10)]));
      expect(after.get(key)?.completedCount).toBe(10);
    });
  });

  describe("query shape", () => {
    it("scopes by TenantId and by the exact experiment/run pairs, never their product", async () => {
      const client = createFakeClient([]);

      await totalsFor(client, [
        { experimentId: "exp-1", runId: "run-1" },
        { experimentId: "exp-2", runId: "run-2" },
      ]);

      const call = client.queryCalls[0]!;
      expect(call.params).toMatchObject({ tenantId: "tenant-1" });
      expect(call.sql).not.toContain("experiment_run_items");
      const sql = readable(call);
      expect(sql).toContain("TenantId = {tenantId:String}");
      expect(sql).toContain(
        "(t.ExperimentId, t.RunId) IN {runPairs:Array(Tuple(String, String))}",
      );
    });

    it("binds one tuple per run pair", async () => {
      const client = createFakeClient([]);

      await totalsFor(client, [
        { experimentId: "exp-1", runId: "run-1" },
        { experimentId: "exp-2", runId: "run-2" },
      ]);

      expect(
        (client.queryCalls[0]!.params as { runPairs: unknown[] }).runPairs,
      ).toHaveLength(2);
    });

    it("adds up the two cost sums with each coalesced, so one absent sum does not null the total", async () => {
      const client = createFakeClient([]);
      await totalsFor(client);

      const sql = readable(client.queryCalls[0]!);
      expect(sql).toContain("ifNull(sumIf(t.TargetCost");
      expect(sql).toContain("ifNull(sumIf(t.EvaluationCost");
    });

    /** @scenario "A repeated item result does not inflate the run" */
    it("dedups redelivered item rows via an IN-tuple subquery, per dev/docs/best_practices/clickhouse-queries.md", async () => {
      const client = createFakeClient([]);
      await totalsFor(client);

      const sql = readable(client.queryCalls[0]!);
      expect(sql).toContain("GROUP BY TenantId, RunId, ProjectionId");
      expect(sql).toMatch(/IN \(/);
    });

    it("groups the aggregates by the run pair, so one query serves a page", async () => {
      const client = createFakeClient([]);
      await totalsFor(client);

      expect(readable(client.queryCalls[0]!)).toContain(
        "GROUP BY experimentId, runId",
      );
    });

    it("adds the occurredAt bound to the outer scope only, never the inner dedup scope", async () => {
      const client = createFakeClient([]);

      await deriveExperimentRunTotals({
        client,
        tenantId: "tenant-1",
        runs: ONE_RUN,
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
      await totalsFor(client);

      expect(client.queryCalls[0]!.sql).not.toContain("occurredAtFrom");
      expect(client.queryCalls[0]!.params).not.toHaveProperty("occurredAtFrom");
    });
  });
});
