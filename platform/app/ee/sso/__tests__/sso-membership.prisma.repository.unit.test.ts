// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The membership row an SSO-admitted arrival gets, on the seat the
 * organization hands to people who join without an invitation (ADR-143).
 *
 * Spec: specs/members/developer-seat.feature
 */
import { describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { PrismaSsoMembershipRepository } from "../sso-membership.prisma.repository";

function fakePrisma({ joinerRole }: { joinerRole: OrganizationUserRole }) {
  return {
    organization: { findUnique: vi.fn(async () => ({ joinerRole })) },
    organizationUser: { create: vi.fn(async () => ({})) },
  };
}

describe("given an organization whose joiner seat is Developer", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("writes a Developer row with no organization-wide grant pending", async () => {
      const prisma = fakePrisma({ joinerRole: OrganizationUserRole.DEVELOPER });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await expect(
        repository.createMembership({
          userId: "user_sam",
          organizationId: "org_acme",
        }),
      ).resolves.toBe("created");

      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: {
          userId: "user_sam",
          organizationId: "org_acme",
          role: OrganizationUserRole.DEVELOPER,
          pendingSsoGrantId: null,
        },
      });
    });
  });
});

describe("given an organization that never changed the setting", () => {
  describe("when a person is admitted through single sign-on", () => {
    /** @scenario The joiner seat setting is Full by default */
    it("writes a Full member row with the organization-wide grant pending", async () => {
      const prisma = fakePrisma({ joinerRole: OrganizationUserRole.MEMBER });
      const repository = new PrismaSsoMembershipRepository(prisma as never);

      await repository.createMembership({
        userId: "user_sam",
        organizationId: "org_acme",
      });

      expect(prisma.organizationUser.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: OrganizationUserRole.MEMBER,
          pendingSsoGrantId: expect.stringMatching(/^rolebinding_/),
        }),
      });
    });
  });
});
