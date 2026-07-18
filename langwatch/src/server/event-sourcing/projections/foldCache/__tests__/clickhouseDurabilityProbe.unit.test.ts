import { describe, expect, it, vi } from "vitest";
import { SecurityError } from "../../../services/errorHandling";
import { ClickHouseDurabilityProbe } from "../clickhouseDurabilityProbe";

function createProbe(rows: unknown[], cluster?: string) {
  const query = vi.fn(async () => ({ json: async () => rows }));
  const probe = new ClickHouseDurabilityProbe({
    resolveClient: (async () => ({ query })) as never,
    table: "trace_summaries",
    idColumn: "TraceId",
    cluster,
  });
  return { probe, query };
}

describe("ClickHouseDurabilityProbe", () => {
  describe("given a replicated cluster", () => {
    describe("when a row is present on every replica", () => {
      it("confirms it at the position of the slowest replica", async () => {
        const { probe } = createProbe(
          [
            {
              aggregateId: "trace-1",
              slowest: 150,
              hostsWithRow: 3,
              hostsTotal: 3,
            },
          ],
          "my_cluster",
        );

        const result = await probe.confirmedUpdatedAt({
          tenantId: "tenant-1",
          aggregateIds: ["trace-1"],
        });

        expect(result.get("trace-1")).toBe(150);
      });
    });

    describe("when a row is missing from one replica", () => {
      it("does not confirm it, because a later read could land there", async () => {
        const { probe } = createProbe(
          [
            {
              aggregateId: "trace-1",
              slowest: 200,
              hostsWithRow: 2,
              hostsTotal: 3,
            },
          ],
          "my_cluster",
        );

        const result = await probe.confirmedUpdatedAt({
          tenantId: "tenant-1",
          aggregateIds: ["trace-1"],
        });

        expect(result.has("trace-1")).toBe(false);
      });
    });

    describe("when an aggregate is absent from the result entirely", () => {
      it("does not confirm it", async () => {
        const { probe } = createProbe([], "my_cluster");

        const result = await probe.confirmedUpdatedAt({
          tenantId: "tenant-1",
          aggregateIds: ["trace-1"],
        });

        expect(result.size).toBe(0);
      });
    });
  });

  describe("tenant isolation", () => {
    it.each([
      ["replicated", "my_cluster"],
      ["unreplicated", undefined],
    ])(
      "scopes the %s query to the tenant, as the first predicate",
      async (_label, cluster) => {
        const { probe, query } = createProbe([], cluster);

        await probe.confirmedUpdatedAt({
          tenantId: "tenant-1",
          aggregateIds: ["trace-1"],
        });

        const sql = query.mock.calls[0]?.[0].query as string;
        const where = sql.slice(sql.indexOf("WHERE"));
        expect(where).toContain("TenantId = {tenantId:String}");
        expect(where.indexOf("TenantId")).toBeLessThan(where.indexOf("IN {"));
        expect(query.mock.calls[0]?.[0].query_params.tenantId).toBe("tenant-1");
      },
    );

    it("resolves the ClickHouse client for the tenant being checked", async () => {
      const query = vi.fn(async () => ({ json: async () => [] }));
      const resolveClient = vi.fn(async () => ({ query }));
      const probe = new ClickHouseDurabilityProbe({
        resolveClient: resolveClient as never,
        table: "trace_summaries",
        idColumn: "TraceId",
      });

      await probe.confirmedUpdatedAt({
        tenantId: "tenant-7",
        aggregateIds: ["trace-1"],
      });

      expect(resolveClient).toHaveBeenCalledWith("tenant-7");
    });

    it("refuses to run unscoped, since aggregate ids repeat across tenants", async () => {
      const { probe, query } = createProbe([]);

      await expect(
        probe.confirmedUpdatedAt({ tenantId: "", aggregateIds: ["trace-1"] }),
      ).rejects.toThrow(SecurityError);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("given an unreplicated deployment", () => {
    describe("when the row exists", () => {
      it("confirms it without fanning out to replicas", async () => {
        const { probe, query } = createProbe([
          { aggregateId: "trace-1", updatedAt: 300 },
        ]);

        const result = await probe.confirmedUpdatedAt({
          tenantId: "tenant-1",
          aggregateIds: ["trace-1"],
        });

        expect(result.get("trace-1")).toBe(300);
        expect(query.mock.calls[0]?.[0].query).not.toContain(
          "clusterAllReplicas",
        );
      });
    });
  });
});
