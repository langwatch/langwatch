import { describe, expect, it } from "vitest";
import type { LaneInfo } from "~/server/app-layer/ops/types";
import {
  countLaneStatuses,
  filterLanes,
  laneStatus,
  resolveTenantScope,
} from "../laneFilters";

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

describe("laneStatus()", () => {
  describe("given a lane its consumer parked", () => {
    /** @scenario "A lane whose consumer parked it reads as parked" */
    it("reads as parked", () => {
      expect(
        laneStatus(lane({ isParked: true, parkReason: "handler threw" })),
      ).toBe("parked");
    });

    /** @scenario "A parked lane stays parked even while a lease has not expired" */
    it("reads as parked ahead of a lease that has not expired", () => {
      expect(
        laneStatus(
          lane({
            isParked: true,
            parkReason: "handler threw",
            leaseRemainingMs: 20_000,
          }),
        ),
      ).toBe("parked");
    });
  });

  describe("given an unparked lane", () => {
    /** @scenario "A lane held by a live lease reads as leased" */
    it("reads as leased while a lease has remaining time", () => {
      expect(laneStatus(lane({ leaseRemainingMs: 15_000 }))).toBe("leased");
    });

    /** @scenario "A lane waiting out its retry backoff reads as backing off" */
    it("reads as backing off while a ready-at deadline is pending", () => {
      expect(laneStatus(lane({ readyAtMs: Date.now() + 30_000 }))).toBe(
        "backoff",
      );
    });

    it("reads as ready when jobs are staged and nothing holds it", () => {
      expect(laneStatus(lane({ pendingJobs: 4 }))).toBe("ready");
    });

    /** @scenario "A lane with nothing staged reads as idle" */
    it("reads as idle when nothing is staged", () => {
      expect(laneStatus(lane({ pendingJobs: 0 }))).toBe("idle");
    });
  });
});

describe("countLaneStatuses()", () => {
  describe("when lanes span every status", () => {
    it("puts each lane in exactly one bucket", () => {
      const counts = countLaneStatuses([
        lane({ isParked: true, parkReason: "boom", leaseRemainingMs: 10 }),
        lane({ leaseRemainingMs: 10 }),
        lane({ readyAtMs: Date.now() + 1_000 }),
        lane({ pendingJobs: 2 }),
        lane({ pendingJobs: 0 }),
      ]);

      expect(counts).toEqual({
        all: 5,
        parked: 1,
        leased: 1,
        backoff: 1,
        ready: 1,
        idle: 1,
      });
    });
  });
});

describe("filterLanes()", () => {
  const lanes = [
    lane({ laneId: "{project_1/fold/traceSummary/agg/trace/a}" }),
    lane({
      laneId: "{project_2/map/spanStorage/agg/trace/b}",
      tenantId: "project_2",
      laneKind: "map",
      laneName: "spanStorage",
    }),
    lane({
      laneId: "{project_2/subscriber/customEvaluationSync/agg/trace/c}",
      tenantId: "project_2",
      laneKind: "subscriber",
      laneName: "customEvaluationSync",
      isParked: true,
      parkReason: "ClickHouse connection refused",
    }),
  ];

  describe("when the operator types a lane-id fragment", () => {
    /** @scenario "Searching narrows the listing by lane id" */
    it("keeps only the lanes whose id contains it", () => {
      const result = filterLanes({ lanes, status: "all", search: "spanStor" });

      expect(result.map((l) => l.laneId)).toEqual([
        "{project_2/map/spanStorage/agg/trace/b}",
      ]);
    });
  });

  describe("when the operator searches for words from a park reason", () => {
    /** @scenario "Searching matches a park reason" */
    it("keeps the parked lane", () => {
      const result = filterLanes({
        lanes,
        status: "all",
        search: "connection refused",
      });

      expect(result.map((l) => l.laneName)).toEqual(["customEvaluationSync"]);
    });
  });

  describe("when a status filter and a search are both applied", () => {
    it("keeps only the lanes matching both", () => {
      expect(
        filterLanes({ lanes, status: "parked", search: "project_2" }),
      ).toHaveLength(1);
      expect(
        filterLanes({ lanes, status: "parked", search: "project_1" }),
      ).toHaveLength(0);
    });
  });
});

describe("resolveTenantScope()", () => {
  const lanes = [lane({ tenantId: "project_1" }), lane({ tenantId: "proj_2" })];

  describe("when the search box holds a bare tenant id that lanes belong to", () => {
    /** @scenario "An exact tenant id unlocks the tenant-wide drain" */
    it("resolves that tenant", () => {
      expect(resolveTenantScope({ lanes, search: " project_1 " })).toBe(
        "project_1",
      );
    });
  });

  describe("when the search box holds anything else", () => {
    /** @scenario "A partial or multi-term search does not unlock the tenant-wide drain" */
    it("resolves nothing for a lane-id fragment", () => {
      expect(
        resolveTenantScope({ lanes, search: "project_1/fold/traceSummary" }),
      ).toBeNull();
    });

    /** @scenario "A partial or multi-term search does not unlock the tenant-wide drain" */
    it("resolves nothing for a tenant prefix no lane matches exactly", () => {
      expect(resolveTenantScope({ lanes, search: "project_" })).toBeNull();
    });

    it("resolves nothing for an empty search", () => {
      expect(resolveTenantScope({ lanes, search: "   " })).toBeNull();
    });

    it("resolves nothing for a multi-term search", () => {
      expect(
        resolveTenantScope({ lanes, search: "project_1 fold" }),
      ).toBeNull();
    });
  });
});
