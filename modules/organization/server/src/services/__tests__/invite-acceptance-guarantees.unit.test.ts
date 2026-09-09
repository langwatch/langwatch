/**
 * @see modules/organization/specs/invitations.feature
 * The four guarantees `InviteAcceptanceService.applyInvite` makes about what an accepted
 * invitation grants, and what it refuses to grant, proved against in-memory port fakes rather
 * than a mocked Prisma client.
 */
import { describe, expect, it } from "vitest";
import { InviteNotFoundError, InviteNotReadyError } from "@langwatch/organization-contract";
import { InviteAcceptanceService } from "../invite-acceptance.service.ts";
import {
  FakeAuthzGrantsService,
  FakeOrganizationInviteRepository,
  makeInvite,
  makeInviteDeps,
} from "./support/invite-fakes.ts";

describe("given a pending invitation for the member role naming one team", () => {
  describe("when the invitee accepts it", () => {
    /** @scenario "Accepting an invitation grants exactly the role the invitation named" */
    it.concurrent("grants the organization role and the named team role, and nothing wider", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({
        id: "invite-1",
        role: "MEMBER",
        teamIds: "team-1",
        requestedBy: "user-inviter",
      });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await service.applyInvite({ userId: "user-invitee", invite });

      expect(invites.hasMembershipState({ userId: "user-invitee", organizationId: "org-1" })).toBe(
        true,
      );

      const bindings = grants.bindingsFor("user-invitee");
      expect(bindings).toHaveLength(2);
      expect(bindings).toContainEqual(
        expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: "org-1", role: "MEMBER" }),
      );
      expect(bindings).toContainEqual(
        expect.objectContaining({ scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" }),
      );
    });
  });

  describe("given the invitation is for an EXTERNAL (lite) member instead", () => {
    describe("when the invitee accepts it", () => {
      it.concurrent("skips the organization-scoped grant, granting only the team", async () => {
        const invites = new FakeOrganizationInviteRepository();
        const grants = new FakeAuthzGrantsService();
        const invite = makeInvite({
          id: "invite-external",
          role: "EXTERNAL",
          teamIds: "team-1",
        });
        invites.seedInvite(invite);
        const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

        await service.applyInvite({ userId: "user-invitee", invite });

        const bindings = grants.bindingsFor("user-invitee");
        expect(bindings).toHaveLength(1);
        expect(bindings[0]).toMatchObject({ scopeType: "TEAM", scopeId: "team-1", role: "VIEWER" });
      });
    });
  });
});

describe("given an invitation that recorded no sender", () => {
  describe("when it is accepted", () => {
    /** @scenario "An invitation with no recorded sender attributes its grants to the service, not the invitee" */
    it.concurrent("attributes the grant to the invite service rather than to the invitee", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-no-sender", requestedBy: null });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await service.applyInvite({ userId: "user-invitee", invite });

      const orgBinding = grants
        .bindingsFor("user-invitee")
        .find((binding) => binding.scopeType === "ORGANIZATION");
      expect(orgBinding?.actor).toEqual({ type: "system", id: "system:invite-service" });
    });

    it.concurrent("attributes the grant to the person who sent it when one is recorded", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-with-sender", requestedBy: "user-inviter" });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await service.applyInvite({ userId: "user-invitee", invite });

      const orgBinding = grants
        .bindingsFor("user-invitee")
        .find((binding) => binding.scopeType === "ORGANIZATION");
      expect(orgBinding?.actor).toEqual({ type: "user", id: "user-inviter" });
    });
  });
});

describe("given an invitation whose expiry has already passed", () => {
  describe("when the invitee tries to accept it", () => {
    /** @scenario "An expired invitation cannot be accepted" */
    it.concurrent("refuses acceptance and creates no membership", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({
        id: "invite-expired",
        expiration: new Date(Date.now() - 1000),
      });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await expect(service.applyInvite({ userId: "user-invitee", invite })).rejects.toBeInstanceOf(
        InviteNotFoundError,
      );

      expect(invites.hasMembershipState({ userId: "user-invitee", organizationId: "org-1" })).toBe(
        false,
      );
      expect(grants.bindingsFor("user-invitee")).toHaveLength(0);
    });
  });
});

describe("given an invitation that was revoked before anybody accepted it", () => {
  describe("when the invited person follows the link", () => {
    /** @scenario "An invitation revoked before acceptance grants nothing" */
    it.concurrent("refuses acceptance and grants nothing", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-revoked", status: "REVOKED" });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      // A revoked invite is refused at the up-front status check, the same as any
      // other non-PENDING status the caller isn't itself retrying into.
      await expect(service.applyInvite({ userId: "user-invitee", invite })).rejects.toBeInstanceOf(
        InviteNotReadyError,
      );

      expect(invites.hasMembershipState({ userId: "user-invitee", organizationId: "org-1" })).toBe(
        false,
      );
      expect(grants.bindingsFor("user-invitee")).toHaveLength(0);
    });
  });
});

describe("given an invitation the caller has already accepted once", () => {
  describe("when the caller follows the same link again", () => {
    /** @scenario "Accepting the same invitation twice does not duplicate the membership" */
    it.concurrent("leaves the membership and grants exactly as they were", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-repeat", teamIds: "team-1" });
      invites.seedInvite(invite);
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await service.applyInvite({ userId: "user-invitee", invite });
      const afterFirst = invites.getInvite("invite-repeat")!;

      // The second follow reads the row as it now stands: ACCEPTED.
      await service.applyInvite({ userId: "user-invitee", invite: afterFirst });

      expect(invites.hasMembershipState({ userId: "user-invitee", organizationId: "org-1" })).toBe(
        true,
      );
      const bindings = grants.bindingsFor("user-invitee");
      expect(bindings).toHaveLength(2);
    });
  });
});

describe("given two acceptances race on the same pending invitation", () => {
  describe("when the loser's claim reads the row after the winner already moved it", () => {
    /** @scenario "A retried acceptance whose grant tail failed repairs the missing grants" */
    it.concurrent("repairs the winner's own missing grant tail instead of refusing", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-race", teamIds: "team-1" });
      // The row already moved to ACCEPTED — an earlier attempt's transaction committed the
      // membership — but the grant tail never ran: the exact shape a crash between the two
      // steps leaves behind. The caller still holds only the stale PENDING read.
      invites.seedInvite({ ...invite, status: "ACCEPTED" });
      invites.seedMembership({ userId: "user-winner", organizationId: "org-1" });
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await service.applyInvite({ userId: "user-winner", invite });

      const bindings = grants.bindingsFor("user-winner");
      expect(bindings).toContainEqual(
        expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: "org-1" }),
      );
      expect(bindings).toContainEqual(
        expect.objectContaining({ scopeType: "TEAM", scopeId: "team-1" }),
      );
    });

    it.concurrent("refuses a different caller who holds no membership on the same stale read", async () => {
      const invites = new FakeOrganizationInviteRepository();
      const grants = new FakeAuthzGrantsService();
      const invite = makeInvite({ id: "invite-race-loser" });
      invites.seedInvite({ ...invite, status: "ACCEPTED" });
      const service = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));

      await expect(service.applyInvite({ userId: "user-loser", invite })).rejects.toBeInstanceOf(
        InviteNotFoundError,
      );

      expect(grants.bindingsFor("user-loser")).toHaveLength(0);
    });
  });
});
