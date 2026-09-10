/**
 * @vitest-environment node
 * The anomaly rows' contract, stated once and run over every backend: the
 * memory twins today, the Redis pair when a test Redis is named.
 * @see specs/ops/anomaly-detection.feature
 */
import type { Anomaly } from "@langwatch/ops-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  AnomalyRateTrackerRepository,
  AnomalyStateRepository,
} from "../anomaly.repository.ts";
import { MemoryAnomalyRateTrackerRepository } from "../memory/memory.anomaly-rate-tracker.repository.ts";
import { MemoryAnomalyStateRepository } from "../memory/memory.anomaly-state.repository.ts";
import { MemoryOpsStore } from "../memory/memory.ops.store.ts";

const FIXED_NOW = 1_760_000_000_000;

function anomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    tenantId: "tenant-1",
    kind: "rate_breaker",
    tier: "soft",
    detectedAt: FIXED_NOW,
    observed: 900,
    baseline: 100,
    ...overrides,
  } as Anomaly;
}

interface Backend {
  state: () => AnomalyStateRepository;
  rates: () => AnomalyRateTrackerRepository & { record(tenantId: string, count?: number): Promise<void> };
}

function contractCases(backend: Backend): void {
  describe("when an anomaly is surfaced", () => {
    it("reads the row back by tenant and kind", async () => {
      await backend.state().upsert(anomaly());

      expect(await backend.state().findByKind("tenant-1", "rate_breaker")).toMatchObject({
        tenantId: "tenant-1",
        tier: "soft",
      });
    });

    it("answers null for a tenant that has none", async () => {
      expect(await backend.state().findByKind("tenant-9", "rate_breaker")).toBeNull();
    });

    it("replaces the row rather than adding a second one", async () => {
      await backend.state().upsert(anomaly());
      await backend.state().upsert(anomaly({ tier: "hard" }));

      const listed = await backend.state().list();

      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ tier: "hard" });
    });
  });

  describe("when an anomaly is cleared", () => {
    it("drops the row from the listing", async () => {
      await backend.state().upsert(anomaly());
      await backend.state().clear("tenant-1", "rate_breaker");

      expect(await backend.state().list()).toEqual([]);
      expect(await backend.state().findByKind("tenant-1", "rate_breaker")).toBeNull();
    });
  });

  describe("when ingest is counted", () => {
    it("lists the tenants that have counted and totals their window", async () => {
      await backend.rates().record("tenant-1", 4);
      await backend.rates().record("tenant-1", 3);

      expect(await backend.rates().listActiveTenants()).toEqual(["tenant-1"]);
      expect(await backend.rates().currentWindowCount("tenant-1", 300)).toBe(7);
    });

    it("answers a zero window for a tenant that never counted", async () => {
      expect(await backend.rates().currentWindowCount("tenant-9", 300)).toBe(0);
    });
  });

  describe("when a baseline is cached", () => {
    it("reads back what was written and null before anything was", async () => {
      expect(await backend.rates().findCachedBaseline("tenant-1")).toBeNull();

      await backend.rates().setCachedBaseline({ tenantId: "tenant-1", baseline: 42 });

      expect(await backend.rates().findCachedBaseline("tenant-1")).toBe(42);
    });
  });
}

describe("given the memory anomaly rows", () => {
  let store: MemoryOpsStore;

  beforeEach(() => {
    store = MemoryOpsStore.create();
  });

  contractCases({
    state: () => MemoryAnomalyStateRepository.create({ store }),
    rates: () => MemoryAnomalyRateTrackerRepository.create({ store, now: () => FIXED_NOW }),
  });
});
