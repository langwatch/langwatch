/**
 * @vitest-environment node
 *
 * Unit coverage for GovernanceTraceActivityClickHouseRepository's row
 * decoding — the piece that moved out of the services that used to build
 * this query inline (GovernanceSetupStateService, QuarantineFillEvaluator).
 *
 * Query shape + tenant scoping are exercised end-to-end by the services'
 * own tests; this file pins the ClickHouse row → typed row conversion,
 * which is CH-JSONEachRow-specific and easy to regress silently (e.g.
 * ClickHouse returning integers as strings depending on column type).
 */
import { describe, expect, it, vi } from "vitest";
import { GovernanceTraceActivityClickHouseRepository } from "../governanceTraceActivity.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

describe("GovernanceTraceActivityClickHouseRepository", () => {
  describe("when probing for recent governance activity", () => {
    it("returns true when the probe finds a row", async () => {
      const client = makeClient([{ hit: 1 }]);
      const repo = new GovernanceTraceActivityClickHouseRepository(
        async () => client as never,
      );

      await expect(
        repo.hasRecentActivity({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toBe(true);
    });

    it("returns false when the probe finds nothing", async () => {
      const client = makeClient([]);
      const repo = new GovernanceTraceActivityClickHouseRepository(
        async () => client as never,
      );

      await expect(
        repo.hasRecentActivity({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toBe(false);
    });
  });

  describe("when aggregating span counts by ingestion source", () => {
    it("coerces stringified spanCount values from ClickHouse", async () => {
      // ClickHouse JSONEachRow may return integers as strings depending on
      // the column type. Number() coercion happens at the repository
      // boundary — every consumer sees a real number.
      const client = makeClient([
        { sourceId: "is-typed-str", spanCount: "75" },
      ]);
      const repo = new GovernanceTraceActivityClickHouseRepository(
        async () => client as never,
      );

      const rows = await repo.findSpanCountsBySource({
        tenantId: "proj-1",
        sinceMs: 1_000,
      });

      expect(rows).toEqual([{ sourceId: "is-typed-str", spanCount: 75 }]);
    });

    it("passes through rows with an empty sourceId — callers decide whether to drop them", async () => {
      const client = makeClient([
        { sourceId: "is-real", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]);
      const repo = new GovernanceTraceActivityClickHouseRepository(
        async () => client as never,
      );

      const rows = await repo.findSpanCountsBySource({
        tenantId: "proj-1",
        sinceMs: 1_000,
      });

      expect(rows).toEqual([
        { sourceId: "is-real", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]);
    });

    it("scopes the query to the tenant and window it was asked for", async () => {
      const client = makeClient([]);
      const repo = new GovernanceTraceActivityClickHouseRepository(
        async () => client as never,
      );

      await repo.findSpanCountsBySource({ tenantId: "proj-1", sinceMs: 5_000 });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("TenantId = {tenantId:String}"),
          query_params: expect.objectContaining({
            tenantId: "proj-1",
            since: 5_000,
          }),
        }),
      );
    });
  });
});
