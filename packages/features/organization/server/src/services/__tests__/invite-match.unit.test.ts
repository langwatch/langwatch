import { describe, expect, it } from "vitest";
import { InviteService } from "../invite.service";

/**
 * D11 — identifier-aware acceptance (specs/identity/resilient-invitations.feature).
 * `InviteService.matchInviteToAcceptor` is pure: the identity read fork's proven-address
 * set is a plain array in, a match decision out.
 */
describe("InviteService.matchInviteToAcceptor", () => {
  describe("given the signed-in user holds a verified identifier for the invited address", () => {
    describe("when matching against the invite", () => {
      /** @scenario "Acceptance works through any verified identifier matching the invite" */
      it("matches via that identifier and reports which one vouched", () => {
        const result = InviteService.matchInviteToAcceptor({
          inviteEmail: "sam@acme.com",
          sessionEmail: "sam@home.net",
          matchable: [{ identifierId: "idf_google", value: "sam@acme.com" }],
        });

        expect(result).toEqual({ matches: true, viaIdentifierId: "idf_google" });
      });
    });
  });

  describe("given the invite expected one method and the account holds another", () => {
    describe("when matching against the invite", () => {
      /** @scenario "The wrong-method dead end is gone" */
      it("matches through whichever verified identifier the account actually holds", () => {
        // The account is Google-born under a different primary email; the
        // invited work address survives only as a verified secondary
        // identifier, not the session email.
        const result = InviteService.matchInviteToAcceptor({
          inviteEmail: "sam@acme.com",
          sessionEmail: "sam.googleborn@gmail.com",
          matchable: [{ identifierId: "idf_cross", value: "sam@acme.com" }],
        });

        expect(result.matches).toBe(true);
        expect(result.viaIdentifierId).toBe("idf_cross");
      });
    });
  });

  describe("given the production Google-linked invitee support case", () => {
    describe("when the invitee signs in with Google and the invite is matched", () => {
      /** @scenario "The Google-linked invitee support case replays green" */
      it("matches via the Google identifier without archiving a user", () => {
        const result = InviteService.matchInviteToAcceptor({
          inviteEmail: "invitee@acme.com",
          sessionEmail: "invitee@acme.com",
          matchable: [{ identifierId: "idf_gl", value: "invitee@acme.com" }],
        });

        expect(result).toEqual({ matches: true, viaIdentifierId: "idf_gl" });
      });
    });
  });
});
