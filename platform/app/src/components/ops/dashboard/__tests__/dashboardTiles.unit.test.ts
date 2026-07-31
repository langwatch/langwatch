import { describe, expect, it } from "vitest";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { buildDashboardTiles } from "../dashboardTiles";

function snapshot(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    totalLanes: 12,
    parkedLanes: 0,
    leasedLanes: 3,
    totalPendingJobs: 47,
    redisMemoryUsedBytes: 3_200_000_000,
    redisMemoryPeakBytes: 3_300_000_000,
    redisMemoryMaxBytes: 10_400_000_000,
    redisConnectedClients: 24,
    redisEngineCpuPercent: 12.3,
    processCpuPercent: 4.2,
    processMemoryUsedMb: 512.4,
    processMemoryTotalMb: 16_384,
    throughputHistory: [],
    laneKinds: [],
    topParkReasons: [],
    ...overrides,
  };
}

describe("buildDashboardTiles()", () => {
  describe("when the collector broadcasts a snapshot", () => {
    /** @scenario "Every headline tile names a field the snapshot carries" */
    it("reports only fields the snapshot actually carries", () => {
      const data = snapshot();

      for (const tile of buildDashboardTiles(data)) {
        expect(Object.keys(data)).toContain(tile.source);
      }
    });

    /** @scenario "Every headline tile names a field the snapshot carries" */
    it("reports no throughput, latency or dead-letter figure", () => {
      const labels = buildDashboardTiles(snapshot())
        .map((tile) => tile.label.toLowerCase())
        .join(" ");

      for (const banned of ["/s", "p50", "p99", "dlq", "dead letter"]) {
        expect(labels).not.toContain(banned);
      }
    });

    /** @scenario "Lane totals come from the collector rather than a client-side sum" */
    it("reports the collector's totals, not a sum over the lane kinds", () => {
      const tiles = buildDashboardTiles(
        snapshot({
          totalLanes: 12,
          parkedLanes: 2,
          leasedLanes: 3,
          totalPendingJobs: 47,
          // A stale breakdown that disagrees with every total above.
          laneKinds: [
            {
              name: "fold",
              displayName: "fold",
              laneCount: 999,
              parkedLaneCount: 999,
              leasedLaneCount: 999,
              totalPendingJobs: 999,
            },
          ],
        }),
      );
      const valueOf = (label: string) =>
        tiles.find((tile) => tile.label === label)?.value;

      expect(valueOf("Lanes")).toBe("12");
      expect(valueOf("Parked")).toBe("2");
      expect(valueOf("Leased")).toBe("3");
      expect(valueOf("Pending")).toBe("47");
    });
  });

  describe("when nothing is parked", () => {
    /** @scenario "Parked lanes are called out only when there are some" */
    it("leaves the parked tile without an alarm colour", () => {
      const parked = buildDashboardTiles(snapshot({ parkedLanes: 0 })).find(
        (tile) => tile.source === "parkedLanes",
      );

      expect(parked?.color).toBeUndefined();
      expect(parked?.sublabel).toBe("none");
    });
  });

  describe("when at least one lane is parked", () => {
    /** @scenario "A parked lane raises the alarm colour on its tile" */
    it("marks the parked tile and says an operator is needed", () => {
      const parked = buildDashboardTiles(snapshot({ parkedLanes: 1 })).find(
        (tile) => tile.source === "parkedLanes",
      );

      expect(parked?.color).toBe("red.500");
      expect(parked?.sublabel).toBe("needs an operator");
    });
  });
});
