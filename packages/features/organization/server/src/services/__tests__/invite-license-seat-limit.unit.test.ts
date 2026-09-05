import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { MemberSeatLimitReachedError } from "../organization-membership-errors.service";
import { InviteService } from "../invite.service";
import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository";

/**
 * A lapsed license keeps binding the seat count it sold (ADR/spec specs/licensing/expired-license-enforcement.feature): once
 * the resolved plan reports the license's own `maxMembers` and the organization already holds that many full members, adding
 * one more is refused exactly like an over-seats organization on a current license.
 */
function buildService(options: { maxMembers: number; currentFullMembers: number }) {
  const prisma = {
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;

  const service = InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({ database: prisma }),
    seats: {
      getMemberCount: vi.fn().mockResolvedValue(options.currentFullMembers),
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

  return service;
}

describe("given a plan resolved from a lapsed license for 5 members", () => {
  /** @scenario "Adding a member is refused once a lapsed license is full" */
  it("refuses adding another full member for exceeding the licensed seats", async () => {
    const service = buildService({ maxMembers: 5, currentFullMembers: 5 });

    await expect(
      service.checkLicenseLimits({
        organizationId: "org-123",
        newInvites: [{ role: "MEMBER", teams: [] }],
      }),
    ).rejects.toThrow(MemberSeatLimitReachedError);
  });
});
