import { describe, expect, it, vi } from "vitest";
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
});
