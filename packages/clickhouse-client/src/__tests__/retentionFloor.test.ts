/**
 * Spec: specs/clickhouse/bounded-reads.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETENTION_FLOOR_MARGIN_MS,
  type RetentionDaysProvider,
  RetentionFloorService,
} from "../retentionFloor";

const DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * DAY_MS;
const DEFAULT_DAYS = 49;
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

const DEFAULT_LOOKBACK =
  DEFAULT_DAYS * DAY_MS + DEFAULT_RETENTION_FLOOR_MARGIN_MS;

function providerReturning(days: number | null): RetentionDaysProvider {
  return { getRetentionDays: vi.fn(async () => days) };
}

function serviceWith(provider?: RetentionDaysProvider) {
  return new RetentionFloorService({
    defaultRetentionDays: DEFAULT_DAYS,
    provider,
  });
}

describe("resolving a retention floor for a read", () => {
  describe("given a tenant whose retention exceeds the default", () => {
    /** @scenario "The floor follows the tenant's own retention policy" */
    it("reaches back to that tenant's retention, not the default", async () => {
      const floor = await serviceWith(providerReturning(400)).getFloorMs({
        table: "evaluation_runs",
        tenantId: "project_long",
        nowMs: NOW,
      });

      expect(NOW - floor).toBe(
        400 * DAY_MS + DEFAULT_RETENTION_FLOOR_MARGIN_MS,
      );
      expect(NOW - floor).toBeGreaterThan(DEFAULT_LOOKBACK);
    });

    /** @scenario "The floor clears the retention horizon rather than sitting on it" */
    it("clears the horizon by a margin rather than sitting on it", async () => {
      const floor = await serviceWith(providerReturning(400)).getFloorMs({
        table: "evaluation_runs",
        tenantId: "project_long",
        nowMs: NOW,
      });

      expect(floor).toBeLessThan(NOW - 400 * DAY_MS);
    });
  });

  describe("given the provider throws", () => {
    /** @scenario "A retention lookup that fails falls back to the platform default" */
    it("falls back to the default rather than an unbounded read", async () => {
      const service = serviceWith({
        getRetentionDays: vi.fn(async () => {
          throw new Error("cascade unavailable");
        }),
      });

      const floor = await service.getFloorMs({
        table: "evaluation_runs",
        tenantId: "project_broken",
        nowMs: NOW,
      });

      expect(NOW - floor).toBe(DEFAULT_LOOKBACK);
      expect(Number.isFinite(floor)).toBe(true);
    });
  });

  describe("given the cascade cannot answer", () => {
    /** @scenario "A retention lookup that fails falls back to the platform default" */
    it("uses the default when the provider returns null", async () => {
      const floor = await serviceWith(providerReturning(null)).getFloorMs({
        table: "trace_summaries",
        tenantId: "project_unknown",
        nowMs: NOW,
      });

      expect(NOW - floor).toBe(DEFAULT_LOOKBACK);
    });

    /**
     * `Infinity > 0` is true, so an infinite retention would sail through the
     * positivity check and produce a floor of `-Infinity` — an unbounded read
     * wearing a bound's clothes, and an invalid ClickHouse timestamp parameter
     * on the way there.
     */
    /** @scenario "A retention lookup that fails falls back to the platform default" */
    it("uses the default when the provider returns a non-finite number", async () => {
      const floor = await serviceWith(
        providerReturning(Number.POSITIVE_INFINITY),
      ).getFloorMs({
        table: "trace_summaries",
        tenantId: "project_infinite",
        nowMs: NOW,
      });

      expect(NOW - floor).toBe(DEFAULT_LOOKBACK);
      expect(Number.isFinite(floor)).toBe(true);
    });
  });

  describe("given many reads arrive on one cold key at once", () => {
    /**
     * The resolved-value cache is only written once the provider answers, so
     * without in-flight memoisation it does nothing for the reads that arrive
     * while the first lookup is still running. That is the shape of the failure
     * this bounds: the worker fleet runs the same sweep at the same moment, so
     * the first burst per tenant fans out one cascade query per read.
     */
    /** @scenario "A cold retention lookup is shared by everyone waiting on it" */
    it("asks the policy cascade once, not once per waiting read", async () => {
      let release!: () => void;
      const inFlight = new Promise<void>((resolve) => {
        release = resolve;
      });
      const getRetentionDays = vi.fn(async () => {
        await inFlight;
        return 400;
      });
      const service = serviceWith({ getRetentionDays });

      const reads = Array.from({ length: 20 }, () =>
        service.getFloorMs({
          table: "evaluation_runs",
          tenantId: "project_stampede",
          nowMs: NOW,
        }),
      );
      release();
      const floors = await Promise.all(reads);

      expect(getRetentionDays).toHaveBeenCalledTimes(1);
      expect(new Set(floors).size).toBe(1);
    });

    /** @scenario "A cold retention lookup is shared by everyone waiting on it" */
    it("gives every waiter an answer when the shared lookup fails", async () => {
      const getRetentionDays = vi.fn(async () => {
        throw new Error("cascade down");
      });
      const service = serviceWith({ getRetentionDays });

      const floors = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.getFloorMs({
            table: "evaluation_runs",
            tenantId: "project_broken",
            nowMs: NOW,
          }),
        ),
      );

      expect(getRetentionDays).toHaveBeenCalledTimes(1);
      expect(floors.every((floor) => NOW - floor === DEFAULT_LOOKBACK)).toBe(
        true,
      );
    });
  });

  describe("given no provider is wired", () => {
    /** @scenario "A caller with no resolver wired still gets a bounded read" */
    it("still bounds the read, at the default", async () => {
      const floor = await serviceWith().getFloorMs({
        table: "evaluation_runs",
        tenantId: "project_plain",
        nowMs: NOW,
      });

      expect(NOW - floor).toBe(DEFAULT_LOOKBACK);
    });
  });

  describe("given a caller replacing an existing fixed floor", () => {
    /** @scenario "Replacing a hand-picked floor can only widen it" */
    it("reaches further back for a tenant on a longer policy", async () => {
      const lookback = await serviceWith(providerReturning(400)).getLookbackMs({
        table: "stored_spans",
        tenantId: "project_long",
        minLookbackMs: NINETY_DAYS,
      });

      expect(lookback).toBeGreaterThan(NINETY_DAYS);
    });

    /** @scenario "Replacing a hand-picked floor can only widen it" */
    it("never reaches less far than the floor it replaced", async () => {
      const lookback = await serviceWith(providerReturning(7)).getLookbackMs({
        table: "stored_spans",
        tenantId: "project_short",
        minLookbackMs: NINETY_DAYS,
      });

      expect(lookback).toBe(NINETY_DAYS);
    });
  });

  // ---------------------------------------------------------------------------
  // The cache. The provider walks a policy cascade, so an uncached lookup puts
  // a database round trip in front of every read this is supposed to make
  // cheaper.
  // ---------------------------------------------------------------------------

  describe("given repeated reads for the same tenant and table", () => {
    /** @scenario "The retention lookup is not repeated for every read" */
    it("asks the policy cascade once", async () => {
      const provider = providerReturning(400);
      const service = serviceWith(provider);

      for (let i = 0; i < 25; i++) {
        await service.getLookbackMs({
          table: "evaluation_runs",
          tenantId: "project_hot",
        });
      }

      expect(provider.getRetentionDays).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The retention lookup is not repeated for every read" */
    it("keeps one tenant's answer from being served to another", async () => {
      const provider: RetentionDaysProvider = {
        getRetentionDays: vi.fn(async ({ tenantId }) =>
          tenantId === "project_long" ? 400 : 10,
        ),
      };
      const service = serviceWith(provider);

      const long = await service.getLookbackMs({
        table: "evaluation_runs",
        tenantId: "project_long",
      });
      const short = await service.getLookbackMs({
        table: "evaluation_runs",
        tenantId: "project_short",
      });

      expect(long).toBeGreaterThan(short);
      expect(provider.getRetentionDays).toHaveBeenCalledTimes(2);
    });

    /** @scenario "The retention lookup is not repeated for every read" */
    it("re-asks once the cached answer expires", async () => {
      const provider = providerReturning(400);
      const service = new RetentionFloorService({
        defaultRetentionDays: DEFAULT_DAYS,
        provider,
        cacheTtlMs: 0,
      });

      await service.getLookbackMs({ table: "x", tenantId: "t" });
      await service.getLookbackMs({ table: "x", tenantId: "t" });

      expect(provider.getRetentionDays).toHaveBeenCalledTimes(2);
    });

    /** @scenario "The retention lookup is not repeated for every read" */
    it("caches a failed lookup too, so a broken cascade is not hammered", async () => {
      const provider: RetentionDaysProvider = {
        getRetentionDays: vi.fn(async () => {
          throw new Error("cascade unavailable");
        }),
      };
      const service = serviceWith(provider);

      await service.getLookbackMs({ table: "x", tenantId: "t" });
      await service.getLookbackMs({ table: "x", tenantId: "t" });

      expect(provider.getRetentionDays).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The retention lookup is not repeated for every read" */
    it("bounds what it remembers, so many tenants cannot grow it forever", async () => {
      const provider = providerReturning(400);
      const service = new RetentionFloorService({
        defaultRetentionDays: DEFAULT_DAYS,
        provider,
        cacheMaxEntries: 10,
      });

      for (let i = 0; i < 50; i++) {
        await service.getLookbackMs({ table: "x", tenantId: `tenant_${i}` });
      }
      // The first tenant was evicted long ago, so it costs a fresh lookup.
      await service.getLookbackMs({ table: "x", tenantId: "tenant_0" });

      expect(provider.getRetentionDays).toHaveBeenCalledTimes(51);
    });
  });
});
