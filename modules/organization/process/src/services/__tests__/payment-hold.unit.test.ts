/**
 * An unpaid invoice holds new members and seats: invites and seat-taking membership changes are
 * refused with a call to update the card; changes that take no seat still go through.
 * @see enterprise/modules/billing/specs/payment-recovery.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { InviteService } from "../../features/invite/services/invite.service.ts";
import type { OrganizationSeatRepository } from "../../repositories/organization-seat.repository.ts";
import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import { assertSeatFree } from "../../rules/payment-hold.rules.ts";
import { OrganizationSeatLicenseService } from "../organization-seat-license.service.ts";

type PlanFacts = Pick<
  Plan,
  "maxMembers" | "maxMembersLite" | "additionsHeldForPayment" | "overrideAddingLimitations"
>;

const HELD: PlanFacts = {
  maxMembers: 10,
  maxMembersLite: 10,
  additionsHeldForPayment: true,
  overrideAddingLimitations: false,
};

function invites({ plan, fullMembers }: { plan: PlanFacts; fullMembers: number }): InviteService {
  return InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({
      database: { customRole: { findMany: vi.fn().mockResolvedValue([]) } } as never,
    }),
    seats: {
      getMemberCount: async () => fullMembers,
      getMembersLiteCount: async () => 0,
      isViewOnlyCustomRole: () => false,
    } as never,
    plans: { getActivePlan: async () => plan } as never,
    grants: createApiFixture<AuthzApi>(),
    roles: {} as never,
    throttle: {} as never,
    baseHost: "https://app.langwatch.ai",
  });
}

function seats(plan: PlanFacts): OrganizationSeatLicenseService {
  return OrganizationSeatLicenseService.create({
    plans: createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
      getActivePlan: async () => createApiFixture<Plan>(plan),
    }),
    memberships: createApiFixture<OrganizationSeatRepository>({
      countMemberSeats: async () => ({ fullMembers: 2, liteMembers: 1, developers: 0 }),
    }),
    notices: { reached: () => {} },
  });
}

describe("given a plan that holds new members for payment, with seats free", () => {
  describe("when an admin invites a new member", () => {
    /** @scenario "While a payment is unpaid, inviting a new member is refused with a call to update the card" */
    it("refuses the invite with member_additions_held_for_payment", async () => {
      await expect(
        invites({ plan: HELD, fullMembers: 2 }).checkLicenseLimits({
          organizationId: "org-1",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).rejects.toMatchObject({ code: "member_additions_held_for_payment", httpStatus: 402 });
    });

    it("refuses a Developer invite too, since it adds a person", async () => {
      await expect(
        invites({ plan: HELD, fullMembers: 2 }).checkLicenseLimits({
          organizationId: "org-1",
          newInvites: [{ role: "DEVELOPER", teams: [] }],
        }),
      ).rejects.toMatchObject({ code: "member_additions_held_for_payment" });
    });

    it("lets an operator acting for the organization through", async () => {
      await expect(
        invites({
          plan: { ...HELD, overrideAddingLimitations: true },
          fullMembers: 2,
        }).checkLicenseLimits({
          organizationId: "org-1",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when an admin enables a member or moves a Lite Member onto a full seat", () => {
    /** @scenario "While a payment is unpaid, a membership change that takes a seat is refused" */
    it("refuses both with member_additions_held_for_payment", async () => {
      const enable = await seats(HELD).checkLimit({ organizationId: "org-1", resource: "members" });
      expect(() => assertSeatFree(enable)).toThrow(
        expect.objectContaining({ code: "member_additions_held_for_payment" }),
      );
      await expect(
        seats(HELD).assertRoleChangeAllowed({
          organizationId: "org-1",
          currentRole: "EXTERNAL",
          userPermissions: undefined,
          role: "MEMBER",
        }),
      ).rejects.toMatchObject({ code: "member_additions_held_for_payment" });
    });
  });

  describe("when a read asks whether a seat is free", () => {
    it("answers not allowed and names the hold instead of throwing", async () => {
      const result = await seats(HELD).checkLimit({ organizationId: "org-1", resource: "members" });

      expect(result).toMatchObject({ allowed: false, heldForPayment: true, current: 2, max: 10 });
    });
  });

  describe("when an admin moves a full member to a Lite Member", () => {
    /** @scenario "While a payment is unpaid, existing members keep their seats and can leave one" */
    it("lets the change through, since it takes no seat", async () => {
      await expect(
        seats(HELD).assertRoleChangeAllowed({
          organizationId: "org-1",
          currentRole: "MEMBER",
          userPermissions: undefined,
          role: "EXTERNAL",
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given an organization paused onto Free limits with more members than Free allows", () => {
  describe("when an admin invites a new member", () => {
    /** @scenario "After the pause, new members are checked against the Free plan's member limit" */
    it("refuses the invite with the member seat limit, not the payment hold", async () => {
      await expect(
        invites({
          plan: { maxMembers: 2, maxMembersLite: 0, overrideAddingLimitations: false },
          fullMembers: 5,
        }).checkLicenseLimits({
          organizationId: "org-1",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    });
  });
});
