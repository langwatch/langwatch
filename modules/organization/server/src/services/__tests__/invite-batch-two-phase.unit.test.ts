/**
 * The admin batch invite writes every record first and only then sends the
 * emails. A provider failure after the commit costs a message, never an
 * invitation — and no email can go out for a record that was rolled back.
 * @see specs/members/update-pending-invitation.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { OrganizationInviteRepository } from "../../repositories/organization-invite.repository.ts";
import { InviteCreationService } from "../invite-creation.service.ts";

const ORGANIZATION = { id: "organization-1", name: "Acme", members: [] };

function serviceWithRecordingOrder() {
  const order: string[] = [];

  const invites = {
    tryFindOrganizationWithMembers: async () => ORGANIZATION,
    tryFindMemberEmail: async () => null,
    tryFindOpenInviteForEmail: async () => null,
    findTeamIdsInOrganization: async ({ teamIds }: { teamIds: string[] }) => teamIds,
    findCustomRolePermissions: async () => [],
    tryFindPersonalTeamInScopes: async () => null,
    createPendingInvite: async (input: { email: string }) => {
      order.push(`record:${input.email}`);
      return {
        id: `invite-${input.email}`,
        email: input.email,
        inviteCode: `code-${input.email}`,
        organizationId: ORGANIZATION.id,
      };
    },
    withTransaction: async <T>(write: (tx: OrganizationInviteRepository) => Promise<T>) =>
      write(invites as unknown as OrganizationInviteRepository),
  } as unknown as OrganizationInviteRepository;

  const sendInvite = vi.fn(async ({ email }: { email: string }) => {
    order.push(`email:${email}`);
  });

  const service = InviteCreationService.create({
    invites,
    seats: { getMemberCount: async () => 0, getMembersLiteCount: async () => 0 } as never,
    plans: { getActivePlan: async () => ({ maxMembers: 100, maxMembersLite: 100 }) } as never,
    grants: { attachBindings: vi.fn(), revokeBindingsWhere: vi.fn() } as never,
    roles: {} as never,
    throttle: { assertInviteSendAllowed: vi.fn() } as never,
    mail: { sendInvite },
    baseHost: "https://app.langwatch.ai",
  } as never);

  return { service, order, sendInvite };
}

describe("the admin batch invite", () => {
  describe("given two people are invited in one go", () => {
    /** @scenario "Admin batch invite creates all records before sending any emails" */
    it("writes both records before the first email leaves", async () => {
      const { service, order, sendInvite } = serviceWithRecordingOrder();

      const result = await service.createInvites({
        organizationId: ORGANIZATION.id,
        validation: "strict",
        invites: [
          { email: "batch-a@example.com", role: "MEMBER", teamIds: "team-1" },
          { email: "batch-b@example.com", role: "MEMBER", teamIds: "team-1" },
        ] as never,
      });

      expect(result.invites).toHaveLength(2);
      expect(sendInvite).toHaveBeenCalledTimes(2);
      expect(order.slice(0, 2).every((step) => step.startsWith("record:"))).toBe(true);
      expect(order.slice(2).every((step) => step.startsWith("email:"))).toBe(true);
    });
  });
});
