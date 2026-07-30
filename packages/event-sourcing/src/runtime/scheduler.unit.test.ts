import { describe, expect, it } from "vitest";
import type { Lane } from "./contracts";
import {
  type LaneCandidate,
  type SchedulerConfig,
  selectLane,
} from "./scheduler";

/**
 * `selectLane` is decision 5's whole scheduler: round-robin fairness, the
 * soft cap, leased/parked skipping and the `enabled` predicate, as one pure
 * function over a candidate list and a set of counters.
 */

const fold = (name: string): Lane => ({ kind: "fold", name });

function candidate(
  overrides: Partial<LaneCandidate> & { tenantId: string },
): LaneCandidate {
  return {
    lane: fold("traceSummary"),
    groupKey: `${overrides.tenantId}/${overrides.lane?.name ?? "traceSummary"}`,
    leased: false,
    parked: false,
    ...overrides,
  };
}

const noCap: SchedulerConfig = { tenantSoftCap: 0 };

describe("selectLane", () => {
  describe("given round-robin across tenants", () => {
    /** @scenario A single tenant with eligible lanes is served on every call */
    it("keeps serving the only tenant with eligible lanes", () => {
      const candidates = [candidate({ tenantId: "t1" })];
      let cursor = 0;
      for (let i = 0; i < 3; i++) {
        const result = selectLane({
          candidates,
          tenantInFlight: new Map(),
          cursor,
          config: noCap,
        });
        if (result === null) throw new Error("expected a selection");
        expect(result.candidate.tenantId).toBe("t1");
        cursor = result.nextCursor;
      }
    });

    /** @scenario Two tenants with eligible lanes are each served in turn */
    it("serves two tenants in turn rather than one twice before the other", () => {
      const candidates = [
        candidate({ tenantId: "t1" }),
        candidate({ tenantId: "t2" }),
      ];
      const first = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      if (first === null) throw new Error("expected a selection");
      const second = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: first.nextCursor,
        config: noCap,
      });
      expect(
        new Set([first.candidate.tenantId, second?.candidate.tenantId]),
      ).toEqual(new Set(["t1", "t2"]));
    });

    /** @scenario A tenant with no eligible lanes is skipped without being asked again */
    it("selects the tenant that has an eligible lane over the one that has none", () => {
      const candidates = [candidate({ tenantId: "t2" })];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      expect(result?.candidate.tenantId).toBe("t2");
    });

    /** @scenario A tenant's own lanes keep the order they were given */
    it("selects a tenant's lanes in the order they were given", () => {
      const candidates = [
        candidate({ tenantId: "t1", lane: fold("b"), leased: true }),
        candidate({ tenantId: "t1", lane: fold("a") }),
      ];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      // "b" is leased and skipped; "a" is next in the given order, not
      // reordered ahead of or instead of "b" by any priority of its own.
      expect(result?.candidate.lane.name).toBe("a");
    });
  });

  describe("given a tenant soft cap", () => {
    /** @scenario A tenant at its soft cap is skipped while another tenant is served */
    it("skips a tenant at its cap and serves another tenant instead", () => {
      const candidates = [
        candidate({ tenantId: "noisy" }),
        candidate({ tenantId: "quiet" }),
      ];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map([["noisy", 2]]),
        cursor: 0,
        config: { tenantSoftCap: 2 },
      });
      expect(result?.candidate.tenantId).toBe("quiet");
    });

    /** @scenario A tenant under its soft cap is never skipped for being large */
    it("keeps a tenant eligible while it is still under its own cap, however large", () => {
      const candidates = [candidate({ tenantId: "big" })];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map([["big", 49]]),
        cursor: 0,
        config: { tenantSoftCap: 50 },
      });
      expect(result?.candidate.tenantId).toBe("big");
    });

    /** @scenario A tenant drops back under its cap and is immediately eligible again */
    it("re-admits a tenant the moment its counter reports it back under cap", () => {
      const candidates = [candidate({ tenantId: "t1" })];
      const overCap = selectLane({
        candidates,
        tenantInFlight: new Map([["t1", 2]]),
        cursor: 0,
        config: { tenantSoftCap: 2 },
      });
      expect(overCap).toBeNull();

      const underCap = selectLane({
        candidates,
        tenantInFlight: new Map([["t1", 1]]),
        cursor: 0,
        config: { tenantSoftCap: 2 },
      });
      expect(underCap?.candidate.tenantId).toBe("t1");
    });

    /** @scenario A soft cap of zero disables the cap for that tenant */
    it("never skips for cap when the soft cap is configured as zero", () => {
      const candidates = [candidate({ tenantId: "t1" })];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map([["t1", 10_000]]),
        cursor: 0,
        config: { tenantSoftCap: 0 },
      });
      expect(result?.candidate.tenantId).toBe("t1");
    });
  });

  describe("given leased and parked lanes", () => {
    /** @scenario A leased lane is skipped in favor of an unleased one */
    it("skips a leased lane and selects an unleased one from another tenant", () => {
      const candidates = [
        candidate({ tenantId: "t1", leased: true }),
        candidate({ tenantId: "t2" }),
      ];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      expect(result?.candidate.tenantId).toBe("t2");
    });

    /** @scenario A parked lane is skipped without stopping its tenant's other lanes */
    it("skips a parked lane but still serves the same tenant's healthy lane", () => {
      const candidates = [
        candidate({ tenantId: "t1", lane: fold("poisoned"), parked: true }),
        candidate({ tenantId: "t1", lane: fold("healthy") }),
      ];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      expect(result?.candidate.lane.name).toBe("healthy");
    });
  });

  describe("given the enabled predicate", () => {
    /** @scenario A disabled lane is never selected by the scheduler */
    it("never selects a lane the enabled predicate reports as disabled", () => {
      const candidates = [
        candidate({ tenantId: "t1", lane: fold("disabled") }),
        candidate({ tenantId: "t2", lane: fold("allowed") }),
      ];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: {
          tenantSoftCap: 0,
          enabled: (lane) => lane.name !== "disabled",
        },
      });
      expect(result?.candidate.lane.name).toBe("allowed");
    });
  });

  describe("given no eligible candidate exists", () => {
    it("returns null rather than an empty selection", () => {
      const candidates = [candidate({ tenantId: "t1", leased: true })];
      const result = selectLane({
        candidates,
        tenantInFlight: new Map(),
        cursor: 0,
        config: noCap,
      });
      expect(result).toBeNull();
    });
  });
});
