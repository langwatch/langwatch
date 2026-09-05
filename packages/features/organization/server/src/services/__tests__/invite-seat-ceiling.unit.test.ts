/**
 * @see specs/members/member-access-editing.feature
 * A Lite Member seat holds Viewer and nothing more, so an invitation may not promise a team
 * role it could never carry. New ones are refused; stored ones are corrected at acceptance.
 */
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository";
import { InviteService } from "../invite.service";

const ORGANIZATION_ID = "organization-1";

function serviceWithInviteWriter() {
  const createPendingInvite = vi.fn(async () => ({ id: "invite-1" }));
  const prisma = {
    organization: { findFirst: vi.fn(async () => ({ id: ORGANIZATION_ID, name: "Acme" })) },
    organizationInvite: { create: createPendingInvite },
  };
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma as never });

  const service = InviteService.create({
    invites,
    seats: { getMemberCount: vi.fn(), getMembersLiteCount: vi.fn() } as never,
    plans: { getActivePlan: vi.fn() } as never,
    grants: { attachBindings: vi.fn(), revokeBindingsWhere: vi.fn() } as never,
    roles: {} as never,
    throttle: { assertInviteSendAllowed: vi.fn() } as never,
    baseHost: "https://app.langwatch.ai",
  });

  return { service, createPendingInvite };
}

describe("given an invitation for a Lite Member seat", () => {
  describe("when it carries team access above Viewer", () => {
    /** @scenario "An invitation cannot carry team access above the invited seat" */
    it("refuses it naming the seat rule, and writes no invite", async () => {
      const { service, createPendingInvite } = serviceWithInviteWriter();

      await expect(
        service.createAdminInviteRecord({
          email: "new@example.com",
          role: "EXTERNAL",
          organizationId: ORGANIZATION_ID,
          teamIds: "team-1",
          teamAssignments: [{ teamId: "team-1", role: "ADMIN" }],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });

      expect(createPendingInvite).not.toHaveBeenCalled();
    });

    /** @scenario "An invitation cannot carry team access above the invited seat" */
    it("refuses a custom role the same way", async () => {
      const { service, createPendingInvite } = serviceWithInviteWriter();

      await expect(
        service.createAdminInviteRecord({
          email: "new@example.com",
          role: "EXTERNAL",
          organizationId: ORGANIZATION_ID,
          teamIds: "team-1",
          teamAssignments: [{ teamId: "team-1", role: "CUSTOM", customRoleId: "role-1" }],
        }),
      ).rejects.toMatchObject({ code: "lite_member_viewer_only" });

      expect(createPendingInvite).not.toHaveBeenCalled();
    });
  });

  describe("when it was stored before the seat rule existed", () => {
    /** @scenario "An invitation cannot carry team access above the invited seat" */
    it("corrects its team access to Viewer at acceptance", () => {
      expect(
        InviteService.resolveInviteTeamMemberships({
          role: "EXTERNAL",
          teamIds: "",
          teamAssignments: [
            { teamId: "team-1", role: "ADMIN" },
            { teamId: "team-2", role: "CUSTOM", customRoleId: "role-1" },
          ],
        }),
      ).toEqual([
        { teamId: "team-1", role: "VIEWER", customRoleId: undefined },
        { teamId: "team-2", role: "VIEWER", customRoleId: undefined },
      ]);
    });
  });
});
