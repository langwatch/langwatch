import { describe, expect, it } from "vitest";

import { scannedGroup, scannedQueue } from "../../services/__tests__/support/queue-scan.ts";
import { countWaitingJobsByTenant } from "../ops-tenant-backlog.rules.ts";

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
