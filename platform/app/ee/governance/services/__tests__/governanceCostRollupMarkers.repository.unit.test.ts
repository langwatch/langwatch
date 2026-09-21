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
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
    insert: vi.fn().mockResolvedValue(undefined),
  };
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

    it("pins the earlier total to the day's latest revision, not to every revision", async () => {
      const { client, repo } = repositoryOver([]);
      await repo.sumDaysByLane({
        tenantId: CELL.tenantId,
        fromDay: "2026-08-01",
        toDay: "2026-08-07",
      });

      // The correctness proof for this is a RESULT, and it lives in
      // `governanceCostRollup.integration.test.ts` ("two cells restated on
      // different dates"), because the rule is entirely in SQL that a stubbed
      // client never executes. What is checkable here is the shape the rule
      // needs: the day's latest revision has to be known BEFORE the sum that
      // uses it, which is a window over the deduped cells and a third layer.
      // A two-layer query cannot express it, so its absence is a real signal.
      const query = queryOf(client);
      expect(query).toContain(
        "max(LatestRevisedAt) OVER (PARTITION BY Day, CostSource)",
      );
      // Never-revised cells compare NULL against that max and must land in the
      // current-amount arm rather than dropping out of the sum.
      expect(query).toContain("ifNull(");
      expect(query).toContain("AS PriorAmountNanoUsd");
      expect(query).toContain(
        "countIf(PriorAmountNanoUsd IS NULL) AS CellsWithoutPreviousAmount",
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

describe("where a restatement key currently sits", () => {
  /**
   * The index that makes a reissue recognisable (settlement 9).
   *
   * Migration `00094` creates it: a `ReplacingMergeTree(EventTimestamp)`
   * ordered by `(TenantId, RestatementKey)` carrying the cell each key was
   * first filed under, and `recordRestatementKeys` writes it in the same
   * `upsert` as the cell.
   *
   * Spelled out rather than imported from the repository's own constant on
   * purpose. What is asserted below is that the rows land in THIS table, and
   * a name read out of the code under test would follow it through a rename
   * and go on passing against a table nothing else knows about.
   */
  const RESTATEMENT_INDEX_TABLE = "governance_cost_rollup_restatement_index";

  /** One stored cell of a euro bill, carrying the key that identifies it. */
  function euroCellRow() {
    return {
      TenantId: CELL.tenantId,
      Day: CELL.day,
      CostSource: CELL.costSource,
      IngestionSourceId: CELL.ingestionSourceId,
      Provider: CELL.provider,
      Model: CELL.model,
      AgentId: CELL.agentId,
      CurrencyCode: "EUR",
      RawActorId: CELL.rawActorId,
      OrganizationId: "org_acme",
      ExactOrEstimate: "exact",
      AmountNanoUsd: null,
      AmountNanoMinor: 10_000_000_000,
      TokensInput: 1_000,
      TokensOutput: 200,
      TokensCacheRead: 0,
      TokensCacheWrite: 0,
      RequestCount: 1,
      RevisionCount: 0,
      PreviousAmountNanoUsd: null,
      RevisedAt: null,
      LastObservedAt: 1_754_625_600,
      PulledItemsJson: JSON.stringify({
        "bucket-hash": {
          amountNanoMinor: 10_000_000_000,
          amountNanoUsd: null,
          observedAtMs: 1_754_625_600_000,
          tokensInput: 1_000,
          tokensOutput: 200,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          exactOrEstimate: "exact",
        },
      }),
      Version: "2026-08-28",
      AppliedEventIds: [],
      CreatedAt: 1_754_625_600_000,
      LastEventOccurredAt: 1_754_625_600_000,
      EventTimestamp: 1_754_625_600_001,
    };
  }

  describe("when a cell holding a provider item is written", () => {
    /** @scenario "A bill reissued in another currency reads as a revision, not as new spend" */
    it("records the cell the key sits in, so the reissue can be matched to it", async () => {
      const { client, repo } = repositoryOver([]);

      await repo.upsert(euroCellRow() as never);

      // Written in the SAME write as the cell and derived from the same
      // event, so a rebuild from history reproduces it. Held only in memory
      // it would be lost by every restart; looked for by scanning the day it
      // would mean reading every row of that day on every correction.
      const indexWrite = client.insert.mock.calls.find(
        (call) => call[0]?.table === RESTATEMENT_INDEX_TABLE,
      );
      expect(indexWrite).toBeDefined();
      expect(indexWrite![0].values).toHaveLength(1);
      // Every dimension the key is NOT part of has to be here, because that
      // is what the reissue is compared against: without the currency and the
      // spender the index cannot tell a reissue from the charge it replaces,
      // and the day reads as new spend on top of the old figure.
      expect(indexWrite![0].values[0]).toMatchObject({
        TenantId: CELL.tenantId,
        RestatementKey: "bucket-hash",
        Day: CELL.day,
        CostSource: CELL.costSource,
        IngestionSourceId: CELL.ingestionSourceId,
        Provider: CELL.provider,
        Model: CELL.model,
        AgentId: CELL.agentId,
        CurrencyCode: "EUR",
        RawActorId: CELL.rawActorId,
      });
    });
  });
});
