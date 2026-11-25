import { describe, expect, it } from "vitest";

import { scannedGroup, scannedQueue } from "../../__tests__/support/queue-scan.ts";
import { countArrivalsByTenant, countWaitingJobsByTenant } from "../ops-tenant-backlog.rules.ts";

describe("countArrivalsByTenant", () => {
  describe("given a tenant whose waiting jobs grew, one steady, one draining and one new", () => {
    /** @scenario "A tenant's arrivals are the growth of its waiting jobs between scans" */
    it("counts only the growth, and a new tenant's whole backlog", () => {
      const previous = new Map([
        ["proj_growing", 10],
        ["proj_steady", 5000],
        ["proj_draining", 40],
      ]);
      const current = new Map([
        ["proj_growing", 25],
        ["proj_steady", 5000],
        ["proj_draining", 12],
        ["proj_new", 3],
      ]);

      expect(countArrivalsByTenant({ previous, current })).toEqual(
        new Map([
          ["proj_growing", 15],
          ["proj_new", 3],
        ]),
      );
    });
  });
});

describe("countWaitingJobsByTenant", () => {
  describe("given every group-id shape the eventing queues build", () => {
    /** @scenario "A group id names its tenant before its first slash" */
    it("attributes each group to the segment before its first slash", () => {
      const queues = [
        scannedQueue({
          name: "{trace_processing}",
          groups: [
            scannedGroup({ groupId: "proj_a/trace/handler/trace:t1", pendingJobs: 2 }),
            scannedGroup({ groupId: "proj_a/fold/summary/trace:t2", pendingJobs: 3 }),
            scannedGroup({ groupId: "proj_b/job/retention", pendingJobs: 4 }),
            scannedGroup({ groupId: "proj_b/cmd/run/key/with/slashes", pendingJobs: 1 }),
          ],
        }),
      ];

      expect(countWaitingJobsByTenant({ queues })).toEqual(
        new Map([
          ["proj_a", 5],
          ["proj_b", 5],
        ]),
      );
    });

    it("leaves out a group that names no tenant", () => {
      const queues = [
        scannedQueue({
          name: "{unkeyed}",
          groups: [
            scannedGroup({ groupId: "3f0c7a52-9d0e-4c1b-a7d4-2f4e6b8a9c10", pendingJobs: 7 }),
            scannedGroup({ groupId: "/orphan/path", pendingJobs: 7 }),
            scannedGroup({ groupId: "proj_c/job/idle", pendingJobs: 0 }),
          ],
        }),
      ];

      expect(countWaitingJobsByTenant({ queues })).toEqual(new Map());
    });
  });
});
