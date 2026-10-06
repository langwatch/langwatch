import type { AuthzApi } from "@langwatch/authz-contract";
import { MemberSeatLimitReachedError } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import { InviteService } from "../invite.service.ts";

/** Lapsed licenses still bind their sold seat count. */
function buildService(options: {
  maxMembers: number;
  currentFullMembers: number;
  maxMembersLite?: number;
  currentLiteMembers?: number;
}) {
  const prisma = {
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
  } as never;

  const service = InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({ database: prisma }),
    seats: {
      getMemberCount: vi.fn().mockResolvedValue(options.currentFullMembers),
      getMembersLiteCount: vi.fn().mockResolvedValue(options.currentLiteMembers ?? 0),
      isViewOnlyCustomRole: vi.fn().mockReturnValue(false),
    } as never,
    plans: {
      getActivePlan: vi.fn().mockResolvedValue({
        maxMembers: options.maxMembers,
        maxMembersLite: options.maxMembersLite ?? 0,
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

describe("given a plan already over its full-seat count", () => {
  /** @scenario An administrator invites a Developer while the plan is at its seat cap */
  it("admits an invitation onto a Developer seat, which enters no metered pool", async () => {
    const service = buildService({ maxMembers: 5, currentFullMembers: 6 });

    await expect(
      service.checkLicenseLimits({
        organizationId: "org-123",
        newInvites: [{ role: "DEVELOPER", teams: [] }],
      }),
    ).resolves.toBeUndefined();
  });

  it("still refuses an invitation onto a full seat", async () => {
    const service = buildService({ maxMembers: 5, currentFullMembers: 6 });

    await expect(
      service.checkLicenseLimits({
        organizationId: "org-123",
        newInvites: [{ role: "MEMBER", teams: [] }],
      }),
    ).rejects.toThrow(MemberSeatLimitReachedError);
  });
});

describe("given an organization already over both seat limits", () => {
  const overBoth = {
    maxMembers: 10,
    currentFullMembers: 12,
    maxMembersLite: 5,
    currentLiteMembers: 7,
  };

  /** @scenario Developers are counted and never capped */
  it("still lets a batch of Developer invitations through", async () => {
    const service = buildService(overBoth);

    await expect(
      service.checkLicenseLimits({
        organizationId: "org-123",
        newInvites: [
          { role: "DEVELOPER", teams: [] },
          { role: "DEVELOPER", teams: [] },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a batch that adds a Full seat", async () => {
    const service = buildService(overBoth);

    await expect(
      service.checkLicenseLimits({
        organizationId: "org-123",
        newInvites: [
          { role: "DEVELOPER", teams: [] },
          { role: "MEMBER", teams: [] },
        ],
      }),
    ).rejects.toThrow(MemberSeatLimitReachedError);
  });
});
