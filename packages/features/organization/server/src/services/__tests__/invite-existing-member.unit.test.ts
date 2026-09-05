/**
 * Inviting somebody who is already in the organization.
 *
 * The refusal is a named one — the admin gets the address back and a reason,
 * not a generic unknown — so the batch is checked before any invite is
 * written.
 */
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository";
import { InviteService } from "../invite.service";

function serviceSeeing(memberEmail: string | null): InviteService {
  const prisma = {
    organizationUser: {
      findFirst: vi.fn(async () =>
        memberEmail === null ? null : { user: { email: memberEmail } },
      ),
    },
  };

  return InviteService.create({
    invites: PrismaOrganizationInviteRepository.create({ database: prisma as never }),
    seats: { getMemberCount: vi.fn(), getMembersLiteCount: vi.fn() } as never,
    plans: { getActivePlan: vi.fn() } as never,
    grants: { attachBindings: vi.fn(), revokeBindingsWhere: vi.fn() } as never,
    roles: {} as never,
    throttle: { assertInviteSendAllowed: vi.fn() } as never,
    baseHost: "https://app.langwatch.ai",
  });
}

describe("given a batch of addresses to invite", () => {
  describe("when one of them already belongs to a member", () => {
    /** @scenario "Inviting an existing member is refused with a reason" */
    it("refuses the batch and names the address", async () => {
      await expect(
        serviceSeeing("already@example.com").assertNotAlreadyMembers({
          emails: ["new@example.com", "already@example.com"],
          organizationId: "org-1",
        }),
      ).rejects.toMatchObject({
        code: "already_organization_member",
        httpStatus: 409,
        fault: "customer",
        meta: { email: "already@example.com" },
      });
    });
  });

  describe("when none of the addresses belong to a member", () => {
    /** @scenario "Inviting a new address still succeeds" */
    it("lets the invites through", async () => {
      await expect(
        serviceSeeing(null).assertNotAlreadyMembers({
          emails: ["new@example.com"],
          organizationId: "org-1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when there is nothing to check", () => {
    it("does not query at all", async () => {
      const prisma = { organizationUser: { findFirst: vi.fn() } };
      const service = InviteService.create({
        invites: PrismaOrganizationInviteRepository.create({ database: prisma as never }),
        seats: { getMemberCount: vi.fn(), getMembersLiteCount: vi.fn() } as never,
        plans: { getActivePlan: vi.fn() } as never,
        grants: { attachBindings: vi.fn(), revokeBindingsWhere: vi.fn() } as never,
        roles: {} as never,
        throttle: { assertInviteSendAllowed: vi.fn() } as never,
        baseHost: "https://app.langwatch.ai",
      });

      await service.assertNotAlreadyMembers({ emails: [], organizationId: "org-1" });

      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
    });
  });
});
