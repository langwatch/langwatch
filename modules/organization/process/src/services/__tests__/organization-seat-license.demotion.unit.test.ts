/**
 * A demotion off a full seat frees that seat, so a full Lite Member pool never refuses it.
 * @see specs/licensing/seat-rotation.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { OrganizationSeatRepository } from "../../repositories/organization-seat.repository.ts";
import { OrganizationSeatLicenseService } from "../organization-seat-license.service.ts";

function seatsWithEveryLiteSeatInUse(): OrganizationSeatLicenseService {
  return OrganizationSeatLicenseService.create({
    plans: createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
      getActivePlan: async () =>
        createApiFixture<Plan>({
          overrideAddingLimitations: false,
          maxMembers: 5,
          maxMembersLite: 2,
        }),
    }),
    memberships: createApiFixture<OrganizationSeatRepository>({
      countMemberSeats: async () => ({ fullMembers: 5, liteMembers: 2, developers: 0 }),
    }),
    notices: { reached: () => {} },
  });
}

describe("OrganizationSeatLicenseService.assertRoleChangeAllowed", () => {
  describe("given every Lite Member seat is in use", () => {
    /** @scenario "Demoting a full member is never refused because the Lite Member seats are full" */
    it("lets a full member be changed to a Lite Member", async () => {
      await expect(
        seatsWithEveryLiteSeatInUse().assertRoleChangeAllowed({
          organizationId: "acme",
          currentRole: "MEMBER",
          userPermissions: undefined,
          role: "EXTERNAL",
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "Moving a Developer to Lite Member needs a free Lite Member seat" */
    it("refuses a Developer moved onto a Lite Member seat the plan has no room for", async () => {
      await expect(
        seatsWithEveryLiteSeatInUse().assertRoleChangeAllowed({
          organizationId: "acme",
          currentRole: "DEVELOPER",
          userPermissions: undefined,
          role: "EXTERNAL",
        }),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });

    it("still refuses a Lite Member promoted onto a full seat the plan has no room for", async () => {
      await expect(
        seatsWithEveryLiteSeatInUse().assertRoleChangeAllowed({
          organizationId: "acme",
          currentRole: "EXTERNAL",
          userPermissions: undefined,
          role: "MEMBER",
        }),
      ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    });
  });
});
