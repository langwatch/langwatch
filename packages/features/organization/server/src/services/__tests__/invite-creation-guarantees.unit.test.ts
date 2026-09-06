/**
 * @see packages/features/organization/specs/invitations.feature
 * What `InviteCreationService` refuses to write when the organization it is asked to invite
 * into is not there, proved against an in-memory repository fake.
 */
import { describe, expect, it } from "vitest";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { InviteCreationService } from "../invite-creation.service.ts";
import {
  FakeOrganizationInviteRepository,
  makeInviteDeps,
  makeOrganization,
} from "./support/invite-fakes.ts";

describe("given an organization id that names no organization", () => {
  describe("when an admin invite is created against it", () => {
    /** @scenario "Creating an invitation for an organization that no longer exists is refused" */
    it("refuses with a not-found error and writes no invite row", async () => {
      const invites = new FakeOrganizationInviteRepository();
      // Deliberately not seeded: `tryFindOrganization` answers null for it.
      const service = InviteCreationService.create(makeInviteDeps({ invites }));

      await expect(
        service.createAdminInviteRecord({
          email: "new@example.com",
          role: "MEMBER",
          organizationId: "org-gone",
          teamIds: "",
        }),
      ).rejects.toBeInstanceOf(OrganizationNotFoundError);

      expect(invites.allInvites()).toHaveLength(0);
    });
  });

  describe("given the organization does exist", () => {
    describe("when an admin invite is created against it", () => {
      it("writes the pending invite and returns it with the organization", async () => {
        const invites = new FakeOrganizationInviteRepository();
        invites.seedOrganization(makeOrganization({ id: "org-1", name: "Acme" }));
        const service = InviteCreationService.create(makeInviteDeps({ invites }));

        const { invite, organization } = await service.createAdminInviteRecord({
          email: "new@example.com",
          role: "MEMBER",
          organizationId: "org-1",
          teamIds: "",
        });

        expect(invite.status).toBe("PENDING");
        expect(invite.email).toBe("new@example.com");
        expect(organization.id).toBe("org-1");
      });
    });
  });
});
