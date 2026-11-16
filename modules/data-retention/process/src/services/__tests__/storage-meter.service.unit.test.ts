/** Spec: specs/data-retention/data-size-metering.feature */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import type { StoredBytesOwners } from "../../channels/data-retention.channels.ts";
import { ClickHouseStorageMeterRepository } from "../../repositories/clickhouse/clickhouse.storage-meter.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import { RedisStorageMeterCacheRepository } from "../../repositories/redis/redis.storage-meter-cache.repository.ts";
import { STORAGE_METER_CACHE_TTL_MS } from "../../repositories/storage-meter-cache.repository.ts";
import type { StorageMeterRepository } from "../../repositories/storage-meter.repository.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

const FRESH_MS = 5 * 60 * 1000;
type OwnerName = keyof StoredBytesOwners;
type Answer = (projectId: string) => Promise<number>;

/** Every owner answering 0 bytes, except the ones a test names. */
function ownersAnswering(answers: Partial<Record<OwnerName, Answer>> = {}): StoredBytesOwners {
  const owner = (name: OwnerName) => ({
    getStoredBytes: ({ projectId }: { projectId: string }) =>
      answers[name]?.(projectId) ?? Promise.resolve(0),
  });
  return {
    traces: owner("traces"),
    logs: owner("logs"),
    evaluations: owner("evaluations"),
    experiments: owner("experiments"),
    scenarios: owner("scenarios"),
    suites: owner("suites"),
    langy: owner("langy"),
  };
}

function meterOver({
  owners,
  eventLog = MemoryStorageMeterRepository.create(),
  now = () => 0,
}: {
  owners: StoredBytesOwners;
  eventLog?: StorageMeterRepository;
  now?: () => number;
}) {
  return StorageMeterService.create({
    owners,
    eventLog,
    now,
    cache: RedisStorageMeterCacheRepository.create({ ttlMs: STORAGE_METER_CACHE_TTL_MS, now }),
  });
}

const refusing: Answer = async () => {
  throw new Error("store unreachable");
};

describe("StorageMeterService", () => {
  describe("when every owner answers", () => {
    /** @scenario "The storage figure is the sum each owning module reports for its own tables" */
    it("sums each owner's bytes and the event log's for the project", async () => {
      const asked: string[] = [];
      const answer =
        (bytes: number): Answer =>
        async (projectId) => {
          asked.push(projectId);
          return bytes;
        };
      const eventLog = MemoryStorageMeterRepository.create();
      eventLog.record({ tenantId: "project-1", bytes: 16 });
      const service = meterOver({
        eventLog,
        owners: ownersAnswering({
          traces: answer(264),
          logs: answer(1011),
          evaluations: answer(63),
          experiments: answer(145),
          scenarios: answer(198),
          suites: answer(8),
          langy: answer(112),
        }),
      });

      expect(await service.getTotalStorageBytes({ tenantId: "project-1" })).toBe(1817);
      expect(asked).toEqual(Array.from({ length: 7 }, () => "project-1"));
    });
  });

  describe("when one owner cannot answer", () => {
    /** @scenario "An owner that cannot answer is left out of the total and logged" */
    it("leaves that owner out of the total instead of failing it", async () => {
      const service = meterOver({
        owners: ownersAnswering({ traces: refusing, suites: async () => 8, langy: async () => 2 }),
      });

      expect(await service.getTotalStorageBytes({ tenantId: "project-1" })).toBe(10);
    });
  });

  describe("when no owner answers", () => {
    const allRefusing = (): StoredBytesOwners =>
      ownersAnswering({
        traces: refusing,
        logs: refusing,
        evaluations: refusing,
        experiments: refusing,
        scenarios: refusing,
        suites: refusing,
        langy: refusing,
      });

    /** @scenario "When no owner answers, the figure degrades to 0 and refreshes on the next read" */
    it("degrades the cold read to 0 and self-heals on the next read", async () => {
      let healed = false;
      const healing: Answer = async () => {
        if (!healed) throw new Error("store unreachable");
        return 77;
      };
      const eventLog = {
        getEventLogBytes: async () => {
          if (!healed) throw new Error("store unreachable");
          return 0;
        },
      };
      const owners = allRefusing();
      const service = meterOver({
        eventLog,
        owners: { ...owners, traces: { getStoredBytes: () => healing("t") } },
      });

      expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);

      healed = true;
      // The cached 0 is served at once, already stale, and refreshed in the background.
      expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(0);
      await vi.waitFor(async () =>
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(77),
      );
    });
  });

  describe("when the event log's bytes are read", () => {
    it("reads eventing's built sum for the tenant under the meter's caps", async () => {
      const statements: Parameters<ClickHouseQueryClient["read"]>[0]["statement"][] = [];
      const clickhouse = clickHouseQueryClientDouble({
        async read({ statement }: Parameters<ClickHouseQueryClient["read"]>[0]) {
          statements.push(statement);
          return { rows: [{ bytes: "16" }] };
        },
      });

      const bytes = await ClickHouseStorageMeterRepository.create({ clickhouse }).getEventLogBytes({
        tenantId: "project-1",
      });

      expect(bytes).toBe(16);
      expect(statements[0]?.kind).toBe("tenant");
      expect(statements[0]?.sql).toContain("FROM event_log");
      expect(statements[0]?.sql).toMatch(/SETTINGS max_threads = 2, max_execution_time = 45$/);
    });
  });

  describe("when summing storage across many tenants for a scope", () => {
    const perTenant: Record<string, number> = { a: 10, b: 20, c: 30 };

    function makeService() {
      const traces = vi.fn(async (projectId: string) => {
        if (projectId === "broken") throw new Error("boom");
        return perTenant[projectId] ?? 0;
      });
      return { traces, service: meterOver({ owners: ownersAnswering({ traces }) }) };
    }

    it("sums each tenant's total", async () => {
      const { service } = makeService();

      expect(await service.getTotalStorageBytesForTenants({ tenantIds: ["a", "b", "c"] })).toBe(60);
    });

    it("counts each tenant once even if passed twice", async () => {
      const { service, traces } = makeService();

      expect(await service.getTotalStorageBytesForTenants({ tenantIds: ["a", "a", "b"] })).toBe(30);
      expect(traces).toHaveBeenCalledTimes(2);
    });

    it("returns 0 for an empty tenant list without asking any owner", async () => {
      const { service, traces } = makeService();

      expect(await service.getTotalStorageBytesForTenants({ tenantIds: [] })).toBe(0);
      expect(traces).not.toHaveBeenCalled();
    });

    it("leaves a tenant whose owner refuses out of the scope total", async () => {
      const { service } = makeService();

      expect(
        await service.getTotalStorageBytesForTenants({ tenantIds: ["a", "broken", "b"] }),
      ).toBe(30);
    });
  });

  describe("given the stale-while-revalidate cache", () => {
    function makeClockService(totals: number[]) {
      let t = 0;
      let call = 0;
      const traces = vi.fn(async () => {
        const total = totals[Math.min(call, totals.length - 1)] ?? 0;
        call += 1;
        return total;
      });
      const service = meterOver({ owners: ownersAnswering({ traces }), now: () => t });
      return {
        service,
        traces,
        advance: (ms: number) => {
          t += ms;
          return t;
        },
      };
    }

    describe("when the cached value is still fresh", () => {
      /** @scenario "Storage size is cached in Redis" */
      it("returns it without recomputing", async () => {
        const { service, traces, advance } = makeClockService([42]);

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        advance(FRESH_MS - 1);
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);

        expect(traces).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the cached value is stale", () => {
      it("returns the stale value immediately and refreshes in the background", async () => {
        const { service, advance } = makeClockService([42, 99]);

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        advance(FRESH_MS);

        // The stale read serves the old value at once, not the refreshed one.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);

        await vi.waitFor(async () =>
          expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(99),
        );
      });

      it("recomputes only once when several stale reads race", async () => {
        const { service, traces, advance } = makeClockService([42, 99]);

        await service.getTotalStorageBytes({ tenantId: "t" });
        advance(FRESH_MS);

        await Promise.all([
          service.getTotalStorageBytes({ tenantId: "t" }),
          service.getTotalStorageBytes({ tenantId: "t" }),
          service.getTotalStorageBytes({ tenantId: "t" }),
        ]);
        await vi.waitFor(() => expect(traces).toHaveBeenCalledTimes(2));

        // The per-tenant lock single-flights the recompute.
        await new Promise((r) => setTimeout(r, 10));
        expect(traces).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a background refresh fails", () => {
      it("keeps serving the last good value instead of caching the failure", async () => {
        let t = 0;
        let unreachable = false;
        const failing: Answer = async () => {
          if (unreachable) throw new Error("cluster unreachable");
          return 0;
        };
        const traces = vi.fn(async () => {
          if (unreachable) throw new Error("cluster unreachable");
          return 42;
        });
        const service = meterOver({
          now: () => t,
          eventLog: {
            getEventLogBytes: () => failing("t"),
          },
          owners: ownersAnswering({
            traces,
            logs: failing,
            evaluations: failing,
            experiments: failing,
            scenarios: failing,
            suites: failing,
            langy: failing,
          }),
        });

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        unreachable = true;
        t += FRESH_MS;

        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
        await vi.waitFor(() => expect(traces).toHaveBeenCalledTimes(2));

        // Still 42: the failed refresh did not poison the cache with a 0.
        expect(await service.getTotalStorageBytes({ tenantId: "t" })).toBe(42);
      });
    });
  });
});
