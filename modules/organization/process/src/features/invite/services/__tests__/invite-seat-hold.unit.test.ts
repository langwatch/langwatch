/**
 * Inviting back a person within their 30-day seat hold takes the held seat, not another.
 * @see specs/licensing/seat-rotation.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../../../repositories/prisma/prisma.organization-invite.repository.ts";
import type { OrganizationInviteSeatCensus } from "../../../../rules/invite-contracts.rules.ts";
import { InviteService } from "../invite.service.ts";

const ORGANIZATION_ID = "org-acme";
const BAR = "bar@acme.example";

/** ACME: 5 full seats, all in use, one of them held for Bar after their removal. */
function acmeWithBarHeld(): InviteService {
  const prisma = { customRole: { findMany: vi.fn().mockResolvedValue([]) } } as never;
  const seats: OrganizationInviteSeatCensus = {
    getMemberCount: async () => 5,
    getMembersLiteCount: async () => 0,
    isViewOnlyCustomRole: () => false,
    findHeldEmails: async ({ emails }) => emails.filter((email) => email.toLowerCase() === BAR),
    takeBackHeldSeat: async () => false,
    withSeatLock: ({ work }) => work({ assertHeld: async () => {} }),
  };
  return InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({ database: prisma }),
    seats,
    plans: createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
      getActivePlan: async () =>
        ({ maxMembers: 5, maxMembersLite: 5, overrideAddingLimitations: false }) as Awaited<
          ReturnType<EntitlementApi["getActivePlan"]>
        >,
    }),
    grants: createApiFixture<AuthzApi>(),
    roles: {} as never,
    throttle: {} as never,
    baseHost: "https://app.langwatch.ai",
  });
}

describe("given every full seat is in use, one of them held for Bar", () => {
  describe("when an administrator invites Bar again as a full member", () => {
    /** @scenario "Inviting back a person within their hold needs no free seat" */
    it("lets the invitation through on the held seat", async () => {
      await expect(
        acmeWithBarHeld().checkLicenseLimits({
          organizationId: ORGANIZATION_ID,
          newInvites: [{ role: "MEMBER", teams: [], email: "Bar@ACME.example" }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when an administrator invites somebody else as a full member", () => {
    /** @scenario "Inviting someone else while every seat is held is refused" */
    it("refuses, as the held seat is Bar's", async () => {
      await expect(
        acmeWithBarHeld().checkLicenseLimits({
          organizationId: ORGANIZATION_ID,
          newInvites: [{ role: "MEMBER", teams: [], email: "new@acme.example" }],
        }),
      ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    });
  });

  describe("when an administrator invites Bar and somebody else in one batch", () => {
    it("refuses, as only Bar's seat is free for the batch", async () => {
      await expect(
        acmeWithBarHeld().checkLicenseLimits({
          organizationId: ORGANIZATION_ID,
          newInvites: [
            { role: "MEMBER", teams: [], email: BAR },
            { role: "MEMBER", teams: [], email: "new@acme.example" },
          ],
        }),
      ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    });
  });
});
