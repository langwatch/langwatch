import { OrganizationNotFoundError } from "@langwatch/organization-contract";
/**
 * @see modules/organization/specs/invitations.feature
 * What `InviteCreationService` refuses to write when the organization it is asked to invite
 * into is not there, proved against an in-memory repository fake.
 */
import { describe, expect, it } from "vitest";

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
      // Deliberately not seeded: `getOrganization` throws for it.
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

    describe("when a Developer invitation names a team", () => {
      /** @scenario A Developer cannot be given a role on a shared team */
      it("refuses it naming the seat and writes no invite row", async () => {
        const invites = new FakeOrganizationInviteRepository();
        invites.seedOrganization(makeOrganization({ id: "org-1", name: "Acme" }));
        const service = InviteCreationService.create(makeInviteDeps({ invites }));

        await expect(
          service.createAdminInviteRecord({
            email: "dev@example.com",
            role: "DEVELOPER",
            organizationId: "org-1",
            teamIds: "team-1",
            teamAssignments: [{ teamId: "team-1", role: "VIEWER" }],
          }),
        ).rejects.toMatchObject({ code: "developer_seat_no_shared_access" });

        expect(invites.allInvites()).toHaveLength(0);
      });
    });

    describe("when a Developer invitation names no team", () => {
      /** @scenario An administrator invites a Developer while the plan is at its seat cap */
      it("writes the pending invite on the Developer seat", async () => {
        const invites = new FakeOrganizationInviteRepository();
        invites.seedOrganization(makeOrganization({ id: "org-1", name: "Acme" }));
        const service = InviteCreationService.create(makeInviteDeps({ invites }));

        const { invite } = await service.createAdminInviteRecord({
          email: "dev@example.com",
          role: "DEVELOPER",
          organizationId: "org-1",
          teamIds: "",
        });

        expect(invite).toMatchObject({ status: "PENDING", role: "DEVELOPER" });
      });
    });
  });
});
