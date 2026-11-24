/**
 * A Billing-only member stays out of every seat pool until a team role says otherwise.
 * @see ../../../../../../specs/licensing/billing-only-invite.feature
 */
import { TeamUserRole } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { OrganizationMembershipRepository } from "../../repositories/organization-membership.repository.ts";
import { withSeatHolds } from "./support/seat-holds.ts";

const MEMBER = { organizationId: "org-1", userId: "user-2" };

function seatHoldsWhere({
  customRolePermissions,
  builtInTeamRole = false,
}: {
  customRolePermissions: unknown[];
  builtInTeamRole?: boolean;
}) {
  return withSeatHolds({
    repository: createApiFixture<OrganizationMembershipRepository>({
      findSharedTeamIds: async () => ["team-1"],
      findTeamGrants: async () => [
        ...(customRolePermissions.length > 0
          ? [{ scopeId: "team-1", role: TeamUserRole.CUSTOM, customRoleId: "role-1" }]
          : []),
        ...(builtInTeamRole
          ? [{ scopeId: "team-1", role: TeamUserRole.VIEWER, customRoleId: null }]
          : []),
      ],
      findCustomRolePermissions: async () => customRolePermissions,
    }),
  }).seatHolds;
}

describe("SeatHoldService.memberTypeOf", () => {
  describe("given a Billing-only member with no team role", () => {
    /** @scenario "Accepting a Billing-only invite takes no seat" */
    it("puts the member in no seat pool", async () => {
      const type = await seatHoldsWhere({ customRolePermissions: [] }).memberTypeOf({
        ...MEMBER,
        standing: { role: "EXTERNAL", billingOnly: true },
      });

      expect(type).toBe("BillingOnly");
    });
  });

  describe("given a Billing-only member that holds a team custom role granting more than viewing", () => {
    it("meters the member as a full seat", async () => {
      const type = await seatHoldsWhere({
        customRolePermissions: [["traces:view", "traces:manage"]],
      }).memberTypeOf({ ...MEMBER, standing: { role: "EXTERNAL", billingOnly: true } });

      expect(type).toBe("FullMember");
    });
  });

  describe("given a Billing-only member that holds a built-in team role", () => {
    it("meters the member as a Lite seat", async () => {
      const type = await seatHoldsWhere({
        customRolePermissions: [],
        builtInTeamRole: true,
      }).memberTypeOf({ ...MEMBER, standing: { role: "EXTERNAL", billingOnly: true } });

      expect(type).toBe("LiteMember");
    });
  });
});
