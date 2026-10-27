/**
 * @vitest-environment node
 * One decision, not two: an arrival that never saw an invitation code still
 * gets the invitation its address already held, with the role and teams that
 * invitation named — and a default membership only when there is none.
 * @see modules/organization/specs/invitations.feature
 */
import { describe, expect, it } from "vitest";

import { InviteService } from "../invite.service.ts";
import {
  FakeAuthzGrantsService,
  FakeOrganizationInviteRepository,
  makeInvite,
  makeInviteDeps,
} from "./support/invite-fakes.ts";

const ORGANIZATION_ID = "org-1";
const USER_ID = "user-invitee";
const EMAIL = "sam@acme.com";

function harness() {
  const invites = new FakeOrganizationInviteRepository();
  const grants = new FakeAuthzGrantsService();
  const service = InviteService.create(makeInviteDeps({ invites, grants }));
  return { invites, grants, service };
}

describe("given a pending invitation for the arriving address", () => {
  describe("when the person arrives without an invitation code", () => {
    it("applies that invitation and names it, granting the role it carried", async () => {
      const { invites, grants, service } = harness();
      invites.seedInvite(
        makeInvite({
          id: "invite-1",
          email: EMAIL,
          role: "ADMIN",
          teamIds: "team-1",
          requestedBy: "user-inviter",
        }),
      );

      await expect(
        service.applyPendingInvite({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          email: EMAIL,
        }),
      ).resolves.toEqual({ applied: true, inviteId: "invite-1" });

      expect(invites.hasMembershipState({ userId: USER_ID, organizationId: ORGANIZATION_ID })).toBe(
        true,
      );
      expect(grants.bindingsFor(USER_ID).length).toBeGreaterThan(0);
    });
  });
});

describe("given no pending invitation for the arriving address", () => {
  describe("when the person arrives", () => {
    it("says so without writing a membership, so the caller falls back to its default", async () => {
      const { invites, grants, service } = harness();
      invites.seedInvite(
        makeInvite({ id: "invite-1", email: "someone-else@acme.com", role: "MEMBER" }),
      );

      await expect(
        service.applyPendingInvite({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          email: EMAIL,
        }),
      ).resolves.toEqual({ applied: false });

      expect(invites.hasMembershipState({ userId: USER_ID, organizationId: ORGANIZATION_ID })).toBe(
        false,
      );
      expect(grants.bindingsFor(USER_ID)).toEqual([]);
    });
  });
});
