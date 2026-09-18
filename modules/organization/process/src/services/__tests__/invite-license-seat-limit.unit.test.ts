import type { AuthzApi } from "@langwatch/authz-contract";
import { MemberSeatLimitReachedError } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import { InviteService } from "../invite.service.ts";

/** Lapsed licenses still bind their sold seat count. */
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
    grants: createApiFixture<AuthzApi>(),
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
