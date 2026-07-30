import { describe, expect, it, vi } from "vitest";
import { QueueService } from "../queue.service";
import {
  NullQueueRepository,
  type QueueRepository,
} from "../repositories/queue.repository";
import type { LaneInfo, LaneKindInfo } from "../types";

function lane(overrides: Partial<LaneInfo> = {}): LaneInfo {
  return {
    laneId: "{project_1/fold/traceSummary/agg/trace/trace_1}",
    tenantId: "project_1",
    laneKind: "fold",
    laneName: "traceSummary",
    pendingJobs: 1,
    headOrderingKey: 1,
    leaseRemainingMs: null,
    isParked: false,
    parkReason: null,
    readyAtMs: null,
    attempts: 0,
    ...overrides,
  };
}

function laneKind(lanes: LaneInfo[]): LaneKindInfo {
  return {
    name: "fold",
    displayName: "fold",
    laneCount: lanes.length,
    parkedLaneCount: lanes.filter((l) => l.isParked).length,
    leasedLaneCount: lanes.filter((l) => l.leaseRemainingMs !== null).length,
    totalPendingJobs: lanes.reduce((sum, l) => sum + l.pendingJobs, 0),
    lanes,
  };
}

function repoWith(overrides: Partial<QueueRepository>): QueueRepository {
  return Object.assign(new NullQueueRepository(), overrides);
}

const twentyFive = Array.from({ length: 25 }, (_, index) =>
  lane({ laneId: `lane-${index}` }),
);

describe("QueueService", () => {
  describe("getLaneKinds()", () => {
    describe("when lane kinds are registered", () => {
      it("returns the summary without carrying every lane back", async () => {
        const service = new QueueService(
          repoWith({
            discoverLaneKinds: vi.fn(async () => ["fold"]),
            scanLaneKinds: vi.fn(async () => [laneKind([])]),
          }),
        );

        const result = await service.getLaneKinds();

        expect(result).toEqual([
          {
            name: "fold",
            displayName: "fold",
            laneCount: 0,
            parkedLaneCount: 0,
            leasedLaneCount: 0,
            totalPendingJobs: 0,
          },
        ]);
      });
    });
  });

  describe("getLanes()", () => {
    describe("when page 1, pageSize 10, 25 lanes", () => {
      it("returns the first 10 with total 25", async () => {
        const service = new QueueService(
          repoWith({
            scanLaneKinds: vi.fn(async () => [laneKind(twentyFive)]),
          }),
        );

        const result = await service.getLanes({
          laneKind: "fold",
          page: 1,
          pageSize: 10,
        });

        expect(result.lanes).toHaveLength(10);
        expect(result.lanes[0]?.laneId).toBe("lane-0");
        expect(result.total).toBe(25);
      });
    });

    describe("when page 3, pageSize 10, 25 lanes", () => {
      it("returns the last 5", async () => {
        const service = new QueueService(
          repoWith({
            scanLaneKinds: vi.fn(async () => [laneKind(twentyFive)]),
          }),
        );

        const result = await service.getLanes({
          laneKind: "fold",
          page: 3,
          pageSize: 10,
        });

        expect(result.lanes).toHaveLength(5);
        expect(result.lanes[0]?.laneId).toBe("lane-20");
      });
    });

    describe("when the lane kind is not present", () => {
      it("returns an empty page rather than throwing", async () => {
        const service = new QueueService(
          repoWith({ scanLaneKinds: vi.fn(async () => []) }),
        );

        const result = await service.getLanes({
          laneKind: "fold",
          page: 1,
          pageSize: 10,
        });

        expect(result).toEqual({
          lanes: [],
          total: 0,
          page: 1,
          pageSize: 10,
        });
      });
    });
  });

  describe("getLaneDetail()", () => {
    describe("when the lane exists", () => {
      it("returns it", async () => {
        const service = new QueueService(
          repoWith({
            scanLaneKinds: vi.fn(async () => [
              laneKind([lane({ laneId: "wanted" }), lane({ laneId: "other" })]),
            ]),
          }),
        );

        const result = await service.getLaneDetail({
          laneKind: "fold",
          laneId: "wanted",
        });

        expect(result?.laneId).toBe("wanted");
      });
    });

    describe("when the lane is not in the kind", () => {
      it("returns null", async () => {
        const service = new QueueService(
          repoWith({
            scanLaneKinds: vi.fn(async () => [laneKind([lane()])]),
          }),
        );

        await expect(
          service.getLaneDetail({ laneKind: "fold", laneId: "missing" }),
        ).resolves.toBeNull();
      });
    });
  });

  describe("getParkedSummary()", () => {
    describe("when lanes are parked across kinds", () => {
      it("asks the repository about every discovered kind", async () => {
        const getParkedSummary = vi.fn(async () => ({
          totalParked: 2,
          clusters: [],
        }));
        const service = new QueueService(
          repoWith({
            discoverLaneKinds: vi.fn(async () => ["fold", "subscriber"]),
            getParkedSummary,
          }),
        );

        const result = await service.getParkedSummary();

        expect(getParkedSummary).toHaveBeenCalledWith({
          laneKinds: ["fold", "subscriber"],
        });
        expect(result.totalParked).toBe(2);
      });
    });
  });

  describe("unparkLane()", () => {
    describe("when the lane was parked", () => {
      it("delegates to the repository and reports it", async () => {
        const unparkLane = vi.fn(async () => ({ wasParked: true }));
        const service = new QueueService(repoWith({ unparkLane }));

        const result = await service.unparkLane({ laneId: "lane-1" });

        expect(unparkLane).toHaveBeenCalledWith({ laneId: "lane-1" });
        expect(result).toEqual({ wasParked: true });
      });
    });
  });

  describe("drainLane()", () => {
    describe("when the lane holds staged jobs", () => {
      it("reports how many were dropped", async () => {
        const service = new QueueService(
          repoWith({ drainLane: vi.fn(async () => ({ jobsRemoved: 12 })) }),
        );

        await expect(service.drainLane({ laneId: "lane-1" })).resolves.toEqual({
          jobsRemoved: 12,
        });
      });
    });
  });

  describe("drainTenant()", () => {
    describe("when a filter is given", () => {
      it("passes it through to the repository", async () => {
        const drainTenant = vi.fn(async () => ({
          lanesDrained: 3,
          jobsDrained: 30,
        }));
        const service = new QueueService(repoWith({ drainTenant }));

        await service.drainTenant({
          tenantId: "project_1",
          laneIdContains: "fold",
        });

        expect(drainTenant).toHaveBeenCalledWith({
          tenantId: "project_1",
          laneIdContains: "fold",
        });
      });
    });
  });
});
