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

  function assertGuarded(call: {
    clickhouse_settings?: Record<string, unknown>;
  }) {
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

  describe("when summing storage across many tenants for a scope", () => {
    function makeMultiTenantService(
      totals: Record<string, number>,
      failing: Set<string> = new Set(),
    ) {
      const resolver = vi.fn(async (tenantId: string) => {
        if (failing.has(tenantId)) throw new Error("cluster unreachable");
        return {
          query: vi.fn(async (arg: { query_params: { tenantId: string } }) => ({
            json: async () => [
              { total: String(totals[arg.query_params.tenantId] ?? 0) },
            ],
          })),
        } as any;
      });
      return { service: new StorageMeterService(resolver), resolver };
    }

    it("sums each tenant's total", async () => {
      const { service } = makeMultiTenantService({ a: 10, b: 20, c: 30 });

      const total = await service.getTotalStorageBytesForTenants([
        "a",
        "b",
        "c",
      ]);

      expect(total).toBe(60);
    });

    it("counts each tenant once even if passed twice", async () => {
      const { service, resolver } = makeMultiTenantService({ a: 10, b: 20 });

      const total = await service.getTotalStorageBytesForTenants([
        "a",
        "a",
        "b",
      ]);

      expect(total).toBe(30);
      // 'a' resolved once despite appearing twice in the input
      expect(resolver).toHaveBeenCalledTimes(2);
    });

    it("returns 0 for an empty tenant list without querying", async () => {
      const { service, resolver } = makeMultiTenantService({});

      const total = await service.getTotalStorageBytesForTenants([]);

      expect(total).toBe(0);
      expect(resolver).not.toHaveBeenCalled();
    });

    it("degrades a failing tenant to 0 instead of failing the scope total", async () => {
      const { service } = makeMultiTenantService(
        { a: 10, b: 20, c: 30 },
        new Set(["b"]),
      );

      const total = await service.getTotalStorageBytesForTenants([
        "a",
        "b",
        "c",
      ]);

      expect(total).toBe(40);
    });
  });

  describe("given the stale-while-revalidate cache", () => {
    const FRESH_MS = 5 * 60 * 1000;

    // A service whose clock we control and whose query returns the next value
    // from `totals` on each call, so we can assert fresh/stale/refresh timing
    // without waiting real time.
    function makeClockService(totals: number[]) {
      let t = 0;
      let call = 0;
      const query = vi.fn(async () => {
        const total = totals[Math.min(call, totals.length - 1)]!;
        call += 1;
        return { json: async () => [{ total: String(total) }] };
      });
      const service = new StorageMeterService(async () => ({ query }) as any, {
        now: () => t,
      });
      return { service, query, advance: (ms: number) => (t += ms) };
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
        await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));

        // A later read serves the value the background refresh wrote.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(99);
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
        // The client resolver is the real fault line: queryTotalBytes catches
        // query errors and falls back, but a failure to even resolve a client
        // (cluster unreachable) propagates. Seed succeeds, the refresh fails.
        let t = 0;
        let resolverCall = 0;
        const query = vi.fn(async () => ({
          json: async () => [{ total: "42" }],
        }));
        const resolver = vi.fn(async () => {
          resolverCall += 1;
          if (resolverCall >= 2) throw new Error("cluster unreachable");
          return { query } as any;
        });
        const service = new StorageMeterService(resolver, { now: () => t });

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        t += FRESH_MS;

        // Stale read returns last good 42; the background refresh throws.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));

        // Still 42 — the failed refresh did not poison the cache with a 0.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        // The one successful read is the seed; the refresh never reached query.
        expect(query).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the cold read fails", () => {
      it("degrades to 0 and self-heals on the next read", async () => {
        let t = 0;
        let resolverCall = 0;
        const query = vi.fn(async () => ({
          json: async () => [{ total: "77" }],
        }));
        const resolver = vi.fn(async () => {
          resolverCall += 1;
          if (resolverCall === 1) throw new Error("cluster unreachable");
          return { query } as any;
        });
        const service = new StorageMeterService(resolver, { now: () => t });

        // First ever read fails -> degraded 0, cached already-stale.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);

        // Next read returns the cached 0 instantly and refreshes in background.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);
        await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));

        // Once healed, the real value is served.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(77);
      });
    });
  });

  describe("given a heavy tenant where the aggregate query can exceed limits", () => {
    describe("when the single aggregate total query fails", () => {
      it("falls back to the per-table breakdown instead of throwing", async () => {
        // The combined UNION ALL aggregate trips the per-query limit, but each
        // table's own query still succeeds — the total should degrade to the
        // sum of the per-table subtotals rather than failing the whole metric.
        const query = vi
          .fn()
          .mockImplementation(async (arg: { query: string }) => {
            if (arg.query.includes("UNION ALL")) {
              throw new Error(
                "Code: 241. DB::Exception: memory limit exceeded",
              );
            }
            return { json: async () => [{ total: "10" }] };
          });
        const client = { query } as const;
        const service = new StorageMeterService(async () => client as any);

        const total = await service.getTotalStorageBytes({
          tenantId: "p-heavy",
        });

        expect(total).toBe(10 * RETENTION_MANAGED_TABLES.length);
        // one failed aggregate attempt + one query per table for the fallback
        expect(query).toHaveBeenCalledTimes(
          1 + RETENTION_MANAGED_TABLES.length,
        );
      });
    });
  });
});
