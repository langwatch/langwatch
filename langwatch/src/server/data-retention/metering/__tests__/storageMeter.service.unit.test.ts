import { describe, expect, it, vi } from "vitest";
import { RETENTION_MANAGED_TABLES } from "../../retentionPolicy.schema";
import { StorageMeterService } from "../storageMeter.service";

/**
 * The metering reads sum a lazily-recomputed MATERIALIZED byteSize(...) column
 * across heavy payload columns, which exceeded the ClickHouse per-query memory
 * limit for large tenants. Every metering query must carry the bounded-memory
 * settings (capped read streams) so the recompute stays within budget instead
 * of failing the read.
 */
describe("StorageMeterService memory guard", () => {
  function makeService() {
    const query = vi.fn().mockResolvedValue({
      json: async () => [{ total: "42" }],
    });
    const client = { query } as const;
    const service = new StorageMeterService(async () => client as any);
    return { service, query };
  }

  function assertGuarded(call: { clickhouse_settings?: Record<string, unknown> }) {
    expect(call.clickhouse_settings).toBeDefined();
    expect(call.clickhouse_settings!.max_threads).toBe(2);
    // A coarse guardrail so a runaway byteSize recompute can't grind for a
    // minute; a materialized read finishes in seconds, well under this.
    expect(call.clickhouse_settings!.max_execution_time).toBe(45);
  }

  describe("when computing the per-category storage breakdown", () => {
    it("passes the bounded-memory settings on every per-table query", async () => {
      const { service, query } = makeService();

      await service.getStorageBreakdown({ tenantId: "project-1" });

      expect(query.mock.calls.length).toBeGreaterThan(0);
      for (const [arg] of query.mock.calls) {
        assertGuarded(arg);
      }
    });
  });

  describe("when computing the total storage bytes", () => {
    it("passes the bounded-memory settings on the aggregate query", async () => {
      const { service, query } = makeService();

      await service.getTotalStorageBytes({ tenantId: "project-total" });

      expect(query).toHaveBeenCalledTimes(1);
      assertGuarded(query.mock.calls[0]![0]);
    });
  });

  describe("when the single aggregate total query fails for a heavy table", () => {
    it("falls back to the per-table breakdown instead of throwing", async () => {
      // The combined UNION ALL aggregate trips the per-query limit, but each
      // table's own query still succeeds — the total should degrade to the
      // sum of the per-table subtotals rather than failing the whole metric.
      const query = vi.fn().mockImplementation(async (arg: { query: string }) => {
        if (arg.query.includes("UNION ALL")) {
          throw new Error("Code: 241. DB::Exception: memory limit exceeded");
        }
        return { json: async () => [{ total: "10" }] };
      });
      const client = { query } as const;
      const service = new StorageMeterService(async () => client as any);

      const total = await service.getTotalStorageBytes({ tenantId: "p-heavy" });

      expect(total).toBe(10 * RETENTION_MANAGED_TABLES.length);
      // one failed aggregate attempt + one query per table for the fallback
      expect(query).toHaveBeenCalledTimes(1 + RETENTION_MANAGED_TABLES.length);
    });
  });
});
