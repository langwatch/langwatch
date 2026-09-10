import { describe, expect, it, vi } from "vitest";
import { PRODUCTION_STORAGE_METER_TABLES } from "@langwatch/data-retention-contract/retention-tables";
import type { ClickHouseQueryClient, QueryRequest } from "@langwatch/clickhouse-client";
import { StorageMeterService } from "../storage-meter.service.ts";

/** The process's one ClickHouse client, stood in for by its `query`. */
function clientOf(query: unknown): ClickHouseQueryClient {
  return { query } as unknown as ClickHouseQueryClient;
}

describe("StorageMeterService memory guard", () => {
  function makeService() {
    const query = vi.fn().mockResolvedValue({ rows: [{ total: "42" }] });
    const service = StorageMeterService.create({ clickhouse: clientOf(query) });
    return { service, query };
  }

  function assertGuarded(call: { settings?: Record<string, unknown> }) {
    const settings = call.settings;
    expect(settings).toBeDefined();
    if (!settings) {
      return;
    }

    expect(settings.max_threads).toBe(2);
    expect(settings.max_execution_time).toBe(45);
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

    it("meters Langy analytics into the traces category", async () => {
      const query = vi.fn(async ({ sql }: QueryRequest) => ({
        rows: [{ total: sql.includes("FROM langy_analytics_events") ? "17" : "0" }],
      }));
      const service = StorageMeterService.create({ clickhouse: clientOf(query) });

      const breakdown = await service.getStorageBreakdown({
        tenantId: "project-langy",
      });

      expect(breakdown.byCategory.traces).toBe(17);
      expect(breakdown.totalBytes).toBe(17);
      expect(
        query.mock.calls.some(([request]) => request.sql.includes("FROM langy_analytics_events")),
      ).toBe(true);
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

  describe("when summing storage across many tenants for a scope", () => {
    function makeMultiTenantService(
      totals: Record<string, number>,
      failing: Set<string> = new Set(),
    ) {
      const query = vi.fn(async (request: QueryRequest) => {
        if (failing.has(request.tenantId)) throw new Error("cluster unreachable");
        return { rows: [{ total: String(totals[request.tenantId] ?? 0) }] };
      });
      return { service: StorageMeterService.create({ clickhouse: clientOf(query) }), query };
    }

    /** Which tenants this client was actually asked about, in order, once each. */
    function tenantsAsked(query: { mock: { calls: [QueryRequest][] } }): string[] {
      return [...new Set(query.mock.calls.map(([request]) => request.tenantId))];
    }

    it("sums each tenant's total", async () => {
      const { service } = makeMultiTenantService({ a: 10, b: 20, c: 30 });

      const total = await service.getTotalStorageBytesForTenants({
        tenantIds: ["a", "b", "c"],
      });

      expect(total).toBe(60);
    });

    it("counts each tenant once even if passed twice", async () => {
      const { service, query } = makeMultiTenantService({ a: 10, b: 20 });

      const total = await service.getTotalStorageBytesForTenants({
        tenantIds: ["a", "a", "b"],
      });

      expect(total).toBe(30);
      // 'a' was asked about once despite appearing twice in the input
      expect(tenantsAsked(query)).toEqual(["a", "b"]);
    });

    it("returns 0 for an empty tenant list without querying", async () => {
      const { service, query } = makeMultiTenantService({});

      const total = await service.getTotalStorageBytesForTenants({ tenantIds: [] });

      expect(total).toBe(0);
      expect(query).not.toHaveBeenCalled();
    });

    it("degrades a failing tenant to 0 instead of failing the scope total", async () => {
      const { service } = makeMultiTenantService({ a: 10, b: 20, c: 30 }, new Set(["b"]));

      const total = await service.getTotalStorageBytesForTenants({
        tenantIds: ["a", "b", "c"],
      });

      expect(total).toBe(40);
    });
  });

  describe("given the stale-while-revalidate cache", () => {
    const FRESH_MS = 5 * 60 * 1000;

    function makeClockService(totals: number[]) {
      let t = 0;
      let call = 0;
      const query = vi.fn(async () => {
        const total = totals[Math.min(call, totals.length - 1)] ?? 0;
        call += 1;
        return { rows: [{ total: String(total) }] };
      });
      const service = StorageMeterService.create({
        clickhouse: clientOf(query),
        now: () => t,
      });
      return {
        service,
        query,
        advance: (ms: number) => {
          t += ms;
          return t;
        },
      };
    }

    describe("when the cached value is still fresh", () => {
      it("returns it without recomputing", async () => {
        const { service, query, advance } = makeClockService([42]);

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        advance(FRESH_MS - 1);
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);

        expect(query).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the cached value is stale", () => {
      it("returns the stale value immediately and refreshes in the background", async () => {
        const { service, query, advance } = makeClockService([42, 99]);

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        advance(FRESH_MS);

        // The stale read serves the old value at once, not the refreshed one.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);

        // A later read serves the value the background refresh wrote.
        await vi.waitFor(async () =>
          expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(99),
        );
      });

      it("recomputes only once when several stale reads race", async () => {
        const { service, query, advance } = makeClockService([42, 99]);

        await service.getTotalStorageBytes({ tenantId: "t" });
        advance(FRESH_MS);

        await Promise.all([
          service.getTotalStorageBytes({ tenantId: "t" }),
          service.getTotalStorageBytes({ tenantId: "t" }),
          service.getTotalStorageBytes({ tenantId: "t" }),
        ]);
        await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));

        // Give any errant second refresh a chance to fire, then prove it didn't:
        // the per-tenant lock single-flights the recompute.
        await new Promise((r) => setTimeout(r, 10));
        expect(query).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a background refresh fails", () => {
      it("keeps serving the last good value instead of caching the failure", async () => {
        // A store that answers nothing at all is the fault line: the seed
        // read succeeds, then every statement refuses, so the aggregate AND
        // every per-table read fail and the refresh propagates rather than
        // reporting the tenant as holding no bytes.
        let t = 0;
        let call = 0;
        const query = vi.fn(async () => {
          call += 1;
          if (call >= 2) throw new Error("cluster unreachable");
          return { rows: [{ total: "42" }] };
        });
        const service = StorageMeterService.create({
          clickhouse: clientOf(query),
          now: () => t,
        });

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        t += FRESH_MS;

        // Stale read returns last good 42; the background refresh throws.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        await vi.waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(1));

        // Still 42 — the failed refresh did not poison the cache with a 0.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
      });
    });

    describe("when the cold read fails", () => {
      it("degrades to 0 and self-heals on the next read", async () => {
        const t = 0;
        let unreachable = true;
        const query = vi.fn(async () => {
          if (unreachable) throw new Error("cluster unreachable");
          return { rows: [{ total: "77" }] };
        });
        const service = StorageMeterService.create({
          clickhouse: clientOf(query),
          now: () => t,
        });

        // First ever read fails -> degraded 0, cached already-stale.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);

        unreachable = false;
        // Next read returns the cached 0 instantly and refreshes in background.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);

        // Once healed, the real value is served.
        await vi.waitFor(async () =>
          expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(77),
        );
      });
    });
  });

  describe("given a heavy tenant where the aggregate query can exceed limits", () => {
    describe("when the single aggregate total query fails", () => {
      it("falls back to the per-table breakdown instead of throwing", async () => {
        // The combined UNION ALL aggregate trips the per-query limit, but each
        // table's own query still succeeds — the total should degrade to the
        // sum of the per-table subtotals rather than failing the whole metric.
        const query = vi.fn().mockImplementation(async (request: QueryRequest) => {
          if (request.sql.includes("UNION ALL")) {
            throw new Error("Code: 241. DB::Exception: memory limit exceeded");
          }
          return { rows: [{ total: "10" }] };
        });
        const service = StorageMeterService.create({ clickhouse: clientOf(query) });

        const total = await service.getTotalStorageBytes({
          tenantId: "p-heavy",
        });

        expect(total).toBe(10 * PRODUCTION_STORAGE_METER_TABLES.length);
        // one failed aggregate attempt + one query per table for the fallback
        expect(query).toHaveBeenCalledTimes(1 + PRODUCTION_STORAGE_METER_TABLES.length);
        const queries = query.mock.calls.map((call) => call[0].sql).join("\n");
        expect(queries).not.toContain("metric_data_points");
        expect(queries).not.toContain("metric_series");
        expect(queries).not.toContain("metric_time_rollups");
      });
    });
  });
});
