/**
 * The seat gate a role change passes through, over the process's own plan
 * provider and membership counts. Promoting a Lite Member takes a full seat,
 * so it is refused when the plan has none left.
 * @see specs/licensing/enforcement-members.feature
 */
import { describe, expect, it, vi } from "vitest";
import { ApiOrganizationSeatLicense } from "../organization.composition";

const PLAN = {
  type: "GROWTH",
  maxMembers: 3,
  maxMembersLite: 10,
  overrideAddingLimitations: false,
};

function seatLicenseWith({ fullMembers }: { fullMembers: number }) {
  const getMemberCount = vi.fn(async () => fullMembers);
  return ApiOrganizationSeatLicense.create({
    plans: { getActivePlan: async () => PLAN } as never,
    memberships: {
      getMemberCount,
      getMembersLiteCount: async () => 1,
    } as never,
  });
}

const promoteLiteMember = (seats: ApiOrganizationSeatLicense) =>
  seats.assertRoleChangeAllowed({
    organizationId: "org-1",
    currentRole: "EXTERNAL",
    userPermissions: undefined,
    role: "MEMBER",
  });

describe("the seat licence on a role change", () => {
  describe("given every full-member seat the plan carries is taken", () => {
    /** @scenario Blocks upgrade from Lite Member to full member when at member limit */
    it("refuses the promotion, naming the allowance that ran out", async () => {
      await expect(promoteLiteMember(seatLicenseWith({ fullMembers: 3 }))).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        meta: { limitType: "members", current: 3, max: 3 },
      });
    });
  });

  describe("given the plan still has a full-member seat", () => {
    /** @scenario Allows upgrade from Lite Member to full member when under limit */
    it("lets the promotion through", async () => {
      await expect(promoteLiteMember(seatLicenseWith({ fullMembers: 2 }))).resolves.toBeUndefined();
    });
  });
});
