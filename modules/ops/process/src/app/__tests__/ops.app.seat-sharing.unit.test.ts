/**
 * @vitest-environment node
 * The seat sharing check is Cloud admin's: off it, the daily wake checks nothing and the read
 * refuses as not found. Spec: modules/ops/specs/seat-sharing-check.feature
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemorySeatSharingCheckRepository } from "../../repositories/memory/memory.seat-sharing-check.repository.ts";
import { SeatSharingCheckService } from "../../services/seat-sharing-check.service.ts";
import { createOpsTestApp } from "./ops.fixture.ts";

function appOn({ cloudOps }: { cloudOps: boolean }) {
  const walked: (string | null)[] = [];
  const checks = MemorySeatSharingCheckRepository.create({ store: MemoryOpsStore.create() });
  const seatSharing = SeatSharingCheckService.create({
    organizationIds: {
      findTenantIdsAfter: async ({ cursor }) => {
        walked.push(cursor);
        return [];
      },
    },
    peers: {
      plans: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      sessions: createApiFixture<AuthApi>(),
      users: createApiFixture<UserApi>(),
    },
    checks,
    now: () => Date.UTC(2026, 10, 6),
  });
  const { app } = createOpsTestApp({ members: { cloudOps }, seatSharing });
  return { app, walked, checks };
}

describe("given the cloud-ops capability is off", () => {
  /** @scenario "A deployment without Cloud admin neither runs nor serves the check" */
  it("checks nothing on the daily wake and refuses the read as not found", async () => {
    const { app, walked, checks } = appOn({ cloudOps: false });

    await app.runSeatSharingCheck();

    expect(walked).toEqual([]);
    await expect(checks.find()).resolves.toEqual([]);
    await expect(app.findSeatSharingChecks()).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("given the cloud-ops capability is on", () => {
  it("runs the check and serves what it kept", async () => {
    const { app, walked } = appOn({ cloudOps: true });

    await expect(app.findSeatSharingChecks()).resolves.toEqual([]);
    await app.runSeatSharingCheck();

    expect(walked).toEqual([null]);
    await expect(app.findSeatSharingChecks()).resolves.toMatchObject([{ readings: [] }]);
  });
});
