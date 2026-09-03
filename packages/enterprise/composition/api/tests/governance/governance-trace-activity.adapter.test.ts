// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import { AppGovernanceTraceActivityAdapter } from "../../src/governance/governance-trace-activity.clickhouse.repository";

function makeClient(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ json: async () => rows }),
  };
}

describe("AppGovernanceTraceActivityAdapter", () => {
  describe("when probing for recent governance activity", () => {
    it("returns true when the probe finds a row", async () => {
      const client = makeClient([{ hit: 1 }]);
      const repository = new AppGovernanceTraceActivityAdapter(
        async () => client as never,
      );

      await expect(
        repository.hasRecentActivity({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toBe(true);
    });

    it("returns false when the probe finds nothing", async () => {
      const client = makeClient([]);
      const repository = new AppGovernanceTraceActivityAdapter(
        async () => client as never,
      );

      await expect(
        repository.hasRecentActivity({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toBe(false);
    });
  });

  describe("when aggregating span counts by ingestion source", () => {
    it("coerces stringified spanCount values from ClickHouse", async () => {
      const client = makeClient([{ sourceId: "is-typed-str", spanCount: "75" }]);
      const repository = new AppGovernanceTraceActivityAdapter(
        async () => client as never,
      );

      await expect(
        repository.findSpanCountsBySource({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toEqual([{ sourceId: "is-typed-str", spanCount: 75 }]);
    });

    it("leaves an empty source id to the caller", async () => {
      const client = makeClient([
        { sourceId: "is-real", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]);
      const repository = new AppGovernanceTraceActivityAdapter(
        async () => client as never,
      );

      await expect(
        repository.findSpanCountsBySource({ tenantId: "proj-1", sinceMs: 1_000 }),
      ).resolves.toEqual([
        { sourceId: "is-real", spanCount: 40 },
        { sourceId: "", spanCount: 10 },
      ]);
    });

    it("binds its requested tenant and time window", async () => {
      const client = makeClient([]);
      const repository = new AppGovernanceTraceActivityAdapter(
        async () => client as never,
      );

      await repository.findSpanCountsBySource({ tenantId: "proj-1", sinceMs: 5_000 });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("TenantId = {tenantId:String}"),
          query_params: expect.objectContaining({ tenantId: "proj-1", since: 5_000 }),
        }),
      );
    });
  });
});
