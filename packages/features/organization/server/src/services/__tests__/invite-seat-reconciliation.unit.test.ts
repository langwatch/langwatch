import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { MemberSeatLimitReachedError } from "../organization-membership.errors";
import { InviteService } from "../invite.service";

/**
 * @see specs/licensing/seat-reconciliation.feature
 *
 * A self-hosted deployment runs uncapped without a license, so an
 * organization can hold more active members than the seats it just bought.
 * Activation itself always succeeds (see `LicensePlanSourceService`, which
 * accepts any signed key regardless of the org's current headcount); this
 * suite pins the OTHER half of "the org lands in an over-seats state": new
 * invitations are refused while the active count exceeds the license, and a
 * disabled member's freed seat is what lets a new invite succeed again.
 */
function buildService(options: { maxMembers: number; currentFullMembers: number }) {
  const prisma = {
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;

  const getMemberCount = vi.fn().mockResolvedValue(options.currentFullMembers);

  const service = InviteService.create({
    prisma,
    seats: {
      getMemberCount,
      getMembersLiteCount: vi.fn().mockResolvedValue(0),
      isViewOnlyCustomRole: vi.fn().mockReturnValue(false),
    } as never,
    plans: {
      getActivePlan: vi.fn().mockResolvedValue({
        maxMembers: options.maxMembers,
        maxMembersLite: 0,
        overrideAddingLimitations: false,
      }),
    } as never,
    grants: {} as AuthzGrantsService,
    roles: {} as never,
    throttle: {} as never,
    baseHost: "https://app.langwatch.ai",
  });

  return { service, getMemberCount };
}

describe("given an organization with 25 active members and a license for 10", () => {
  describe("when an admin invites another member", () => {
    /** @scenario "Inviting another member is refused while over the seat count" */
    it("is refused for exceeding the licensed seats", async () => {
      const { service } = buildService({ maxMembers: 10, currentFullMembers: 25 });

      await expect(
        service.checkLicenseLimits({
          organizationId: "org-123",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).rejects.toThrow(MemberSeatLimitReachedError);
    });
  });
});

describe("given disabling members has brought the organization within its 10-seat license", () => {
  describe("when an admin invites another member", () => {
    /** @scenario "Disabling a member returns their seat" */
    it("succeeds once the active count is at the license again", async () => {
      const { service, getMemberCount } = buildService({ maxMembers: 10, currentFullMembers: 10 });

      // Disabled members are out of the seat pool: the count the seat census
      // reports already reflects the disables, not a live re-count here.
      getMemberCount.mockResolvedValue(9);

      await expect(
        service.checkLicenseLimits({
          organizationId: "org-123",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "Disabling a member returns their seat" */
    it("is refused again once the freed seats are used up", async () => {
      const { service } = buildService({ maxMembers: 10, currentFullMembers: 10 });

      await expect(
        service.checkLicenseLimits({
          organizationId: "org-123",
          newInvites: [{ role: "MEMBER", teams: [] }],
        }),
      ).rejects.toThrow(MemberSeatLimitReachedError);
    });
  });
});
