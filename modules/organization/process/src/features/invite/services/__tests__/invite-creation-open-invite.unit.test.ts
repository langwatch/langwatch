/**
 * An address that already holds an invite is never skipped in silence: a live invite refuses the
 * batch, and one held for an unpaid seat checkout gives way to the direct invite.
 * @see modules/organization/specs/invitations.feature
 */
import { describe, expect, it } from "vitest";

import { InviteCreationService } from "../invite-creation.service.ts";
import {
  FakeInviteMail,
  FakeOrganizationInviteRepository,
  makeInvite,
  makeInviteDeps,
  makeOrganization,
} from "./support/invite-fakes.ts";

const ORGANIZATION_ID = "org-1";

function setUp() {
  const invites = new FakeOrganizationInviteRepository();
  const organization = makeOrganization({ id: ORGANIZATION_ID });
  invites.seedOrganization(organization);
  invites.getOrganizationWithMembers = async () => ({ ...organization, members: [] });
  invites.findMemberEmails = async () => [];
  invites.findCustomRolePermissions = async () => [];
  invites.findPersonalTeamsInScopes = async () => [];
  invites.findTeamIdsInOrganization = async ({ teamIds }) => teamIds;
  const mail = new FakeInviteMail();
  const service = InviteCreationService.create(makeInviteDeps({ invites, mail }));
  const inviteSam = () =>
    service.createInvites({
      organizationId: ORGANIZATION_ID,
      validation: "lenient",
      invites: [{ email: "sam@acme.com", role: "MEMBER" }],
    });
  return { invites, mail, inviteSam };
}

describe("given an address that already holds a pending invitation", () => {
  describe("when an administrator invites it again from the members screen", () => {
    /** @scenario "Inviting an address that already holds a live invitation is refused, not skipped" */
    it("refuses the batch as a duplicate naming the address and sends nothing", async () => {
      const { invites, mail, inviteSam } = setUp();
      invites.seedInvite(
        makeInvite({ id: "invite-live", email: "sam@acme.com", status: "PENDING" }),
      );

      const refusal = await inviteSam().catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "duplicate_invite",
        meta: { email: "sam@acme.com" },
      });
      expect(invites.allInvites().map((invite) => invite.id)).toEqual(["invite-live"]);
      expect(mail.sentInvites).toHaveLength(0);
    });
  });
});

describe("given an address held as payment-pending on a seat checkout never paid", () => {
  describe("when an administrator invites it from the members screen", () => {
    /** @scenario "A direct invitation replaces one held for an unpaid seat checkout" */
    it("creates and mails a pending invitation and drops the held one", async () => {
      const { invites, mail, inviteSam } = setUp();
      invites.seedInvite(
        makeInvite({
          id: "invite-held",
          email: "sam@acme.com",
          status: "PAYMENT_PENDING",
          subscriptionId: "sub-abandoned",
          expiration: null,
        }),
      );

      const result = await inviteSam();

      expect(result.invites.map((entry) => entry.invite.email)).toEqual(["sam@acme.com"]);
      expect(result.invites[0]?.invite.status).toBe("PENDING");
      expect(mail.sentInvites.map((sent) => sent.email)).toEqual(["sam@acme.com"]);
      expect(invites.allInvites().map((invite) => invite.status)).toEqual(["PENDING"]);
    });
  });
});
