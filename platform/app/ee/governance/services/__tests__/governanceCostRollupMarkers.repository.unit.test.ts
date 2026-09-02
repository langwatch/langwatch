// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The read side of §15's two markers: that they are read dedup-safely, and
 * that they survive the trip out of ClickHouse in the units the caller
 * expects.
 *
 * Both matter for the same reason. `governance_cost_rollup_1d` is a
 * ReplacingMergeTree whose dedup runs in background merges, so between a
 * restatement and the merge that collapses it BOTH versions are in the table:
 * a marker read without `argMax(..., EventTimestamp)` comes back from whichever
 * version the scan happened to reach, and the screen annotates a current figure
 * with a superseded revision.
 *
 * Spec: specs/governance/governance-cost-restatement-markers.feature
 * Decision: ADR-128 §15.
 */
import { describe, expect, it, vi } from "vitest";

import { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ json: async () => rows }) };
}

function repositoryOver(rows: unknown[]) {
  const client = makeClient(rows);
  return {
    client,
    repo: new GovernanceCostRollupClickHouseRepository(
      async () => client as never,
    ),
  };
}

function queryOf(client: { query: ReturnType<typeof vi.fn> }): string {
  return String(client.query.mock.calls[0]?.[0]?.query ?? "");
}

const CELL = {
  tenantId: "proj_governance_home",
  day: "2026-08-01",
  costSource: "pulled",
  ingestionSourceId: "src_1",
  provider: "anthropic_admin",
  model: "anthropic/claude-sonnet-5",
  agentId: "",
  currencyCode: "USD",
  rawActorId: "ada@acme.example",
} as const;

describe("GovernanceCostRollupClickHouseRepository", () => {
  describe("when reading one cell", () => {
    it("resolves both markers to the version that won", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.findCellWithApplied(CELL);

      const query = queryOf(client);
      // `EventTimestamp` is the ReplacingMergeTree's replacement version. The
      // column named `Version` is the fold's schema stamp and deduping on it
      // would order the rows on an axis that has nothing to do with recency.
      expect(query).toContain(
        "argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS RevisedAt",
      );
      expect(query).toContain(
        "toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LastObservedAt",
      );
    });

    it("wraps the nullable marker so a withdrawn revision is not resurrected", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.findCellWithApplied(CELL);

      // Whether argMax skips a NULL first argument has varied between
      // ClickHouse versions, and a cell restated back to unrevised has to read
      // as unrevised on every one of them — otherwise an OLDER version's
      // revision date is shown beside a figure that is current. A tuple is
      // never NULL, so no version is ever passed over.
      expect(queryOf(client)).toContain("tuple(toUnixTimestamp(RevisedAt))");
    });

    it("decodes the markers as numbers, whatever shape the driver hands back", async () => {
      // ClickHouse renders wide integers as strings in JSONEachRow depending
      // on the column type, so a repository that passed them through would put
      // a string where every caller expects seconds.
      const { repo } = repositoryOver([
        {
          ...Object.fromEntries(
            Object.entries(CELL).map(([key, value]) => [
              key.charAt(0).toUpperCase() + key.slice(1),
              value,
            ]),
          ),
          RevisedAt: "1754366400",
          LastObservedAt: "1754625600",
          LatestEventTimestamp: "17",
        },
      ]);

      const row = await repo.findCellWithApplied(CELL);
      expect(row?.RevisedAt).toBe(1_754_366_400);
      expect(row?.LastObservedAt).toBe(1_754_625_600);
    });

    it("keeps an absent revision absent rather than turning it into 1970", async () => {
      const { repo } = repositoryOver([
        { TenantId: CELL.tenantId, RevisedAt: null, LastObservedAt: "0" },
      ]);

      const row = await repo.findCellWithApplied(CELL);
      expect(row?.RevisedAt).toBe(null);
      // The epoch here is the ALTER's backfill, and it means "no pull has ever
      // touched this day" — which reads as settled, deliberately.
      expect(row?.LastObservedAt).toBe(0);
    });
  });

  describe("when totalling a window by day and lane", () => {
    it("dedups both markers before aggregating them", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysByLane({
        tenantId: CELL.tenantId,
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });

      const query = queryOf(client);
      // The dedup CANNOT share a pass with the aggregation: picking a cell's
      // surviving version groups by the sort key, and a day's marker groups by
      // two of its columns. So the inner query collapses, the outer one
      // aggregates only survivors.
      expect(query).toContain(
        "argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS LatestRevisedAt",
      );
      expect(query).toContain(
        "toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LatestLastObservedAt",
      );
      expect(query).toContain("max(LatestRevisedAt)");
      expect(query).toContain("max(LatestLastObservedAt)");
    });

    it("reconstructs the day's earlier total from the cells that changed", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysByLane({
        tenantId: CELL.tenantId,
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });

      // A cell nobody revised contributed its current figure to the older
      // total too; only the revised ones swap in what they used to hold.
      // Summing only the revised cells would report a "was" far smaller than
      // the day ever cost.
      expect(queryOf(client)).toContain("AS LatestPriorAmountNanoUsd");
      expect(queryOf(client)).toContain(
        "countIf(LatestPriorAmountNanoUsd IS NULL) AS CellsWithoutPreviousAmount",
      );
    });

    it("returns the markers beside the figures they annotate", async () => {
      const { repo } = repositoryOver([
        {
          Day: "2026-08-01",
          CostSource: "pulled",
          AmountNanoUsd: "9000000000",
          CellsWithoutAmount: "0",
          CurrenciesWithoutUsdAmount: [],
          RevisedAt: "1754366400",
          PreviousAmountNanoUsd: "12340000000",
          CellsWithoutPreviousAmount: "0",
          LastObservedAt: "1754625600",
        },
      ]);

      const [row] = await repo.sumDaysByLane({
        tenantId: CELL.tenantId,
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });

      expect(row).toMatchObject({
        amountNanoUsd: 9_000_000_000,
        revisedAt: 1_754_366_400,
        previousAmountNanoUsd: 12_340_000_000,
        cellsWithoutPreviousAmount: 0,
        lastObservedAt: 1_754_625_600,
      });
    });
  });
});
