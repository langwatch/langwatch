/** @see modules/staff-access/specs/staff-access-functions-platform.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  platformPeers,
  platformPeerState,
} from "../../app/__tests__/support/staff-access-platform-peers.ts";
import { StaffAccessPlatformFunctionReadsService } from "../staff-access-platform-function-reads.service.ts";

describe("the platform ops function reads", () => {
  /** @scenario "The tenant ids of one step are capped" */
  it("counts every parked tenant of a step and lists at most 20 ids", async () => {
    const state = platformPeerState();
    state.parkedTenants = 30;
    const reads = StaffAccessPlatformFunctionReadsService.create({
      ops: platformPeers.ops(state),
      langy: platformPeers.mirror(state),
      projects: createApiFixture({}),
      dataRetention: platformPeers.dataRetention(),
      traces: createApiFixture({}),
      evaluations: platformPeers.evaluatorUsage(state),
    }).reads;

    const answered = await reads["upgrade.step_failures"]({
      input: { stepId: "dataset:move-records" },
      organizationId: "",
      at: Temporal.Instant.from("2026-11-02T10:00:00Z"),
    });

    expect(answered.items).toHaveLength(1);
    expect(answered.items[0]?.failedTenants).toBe(30);
    expect(answered.items[0]?.tenantIds).toHaveLength(20);
  });
});
