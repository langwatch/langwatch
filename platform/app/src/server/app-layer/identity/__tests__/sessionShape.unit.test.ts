import { describe, expect, it, vi } from "vitest";
import { OrganizationMfaService } from "../organization-mfa.service";
import {
  deriveSessionAmr,
  signInMethodLabelFor,
  signInProviderForPath,
} from "../session-claims";
import { SessionClaimsService } from "../session-claims.service";
import {
  SessionInventoryService,
  type SessionRecord,
} from "../session-inventory.service";

/**
 * What a session records, and what can and cannot end one (D06).
 *
 * The two guarantees under test here are the ones the deliverable promised
 * out loud: landing it signs nobody out, and the one instrument that ends
 * sessions ends exactly the sessions one sign-in method minted.
 */

const sessionRow = ({
  id,
  identifierId = null,
  amr = [],
}: {
  id: string;
  identifierId?: string | null;
  amr?: readonly string[];
}): SessionRecord => ({
  id,
  sessionToken: `token-${id}`,
  identifierId,
  amr: [...amr],
  ipAddress: null,
  userAgent: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  expires: new Date("2026-12-31T00:00:00.000Z"),
});

const inventoryOver = (sessions: readonly SessionRecord[]) => {
  const live = new Map(sessions.map((session) => [session.id, session]));
  const dropTokens = vi.fn(async () => undefined);
  const deleteByIds = vi.fn(async ({ ids }: { ids: readonly string[] }) => {
    let ended = 0;
    for (const id of ids) {
      if (live.delete(id)) ended += 1;
    }
    return ended;
  });
  const service = new SessionInventoryService({
    records: {
      listForUser: async () => [...live.values()],
      listForIdentifier: async ({ userId, identifierId }) =>
        [...live.values()].filter(
          (session) =>
            session.identifierId === identifierId && userId === "sam",
        ),
      deleteByIds,
    },
    cache: { dropTokens },
  });
  return { service, live, dropTokens, deleteByIds };
};

/** An organization that asks for nothing, with a member who proves nothing. */
const organizationAskingNothing = () => {
  const membersOf = vi.fn(async () => []);
  const amrFor = vi.fn(async () => null);
  return new OrganizationMfaService({
    settings: {
      read: async () => ({ mfaRequired: false, name: "acme", slug: "acme" }),
      write: async () => undefined,
    },
    sessions: { amrFor },
    members: {
      membersOf,
      accountFactorFor: async () => ({
        accountEnrollmentEnabled: false,
        passkeyCount: 0,
      }),
      isMember: async () => true,
    },
    connections: { assertedFactorsFor: async () => null },
    notifier: { requirementTurnedOn: async () => undefined },
    offered: () => true,
    entitled: async () => true,
  });
};

describe("the session shape", () => {
  describe("given sessions that record nothing about what they proved", () => {
    describe("when no organization requires two-step verification", () => {
      /** @scenario "Landing the change signs nobody out" */
      it("refuses none of them and ends none of them", async () => {
        const sessions = [
          sessionRow({ id: "before-the-column" }),
          sessionRow({ id: "ordinary-password", amr: ["pwd"] }),
        ];
        const { live } = inventoryOver(sessions);
        const organization = organizationAskingNothing();

        for (const session of sessions) {
          const standing = await organization.standingForSession({
            userId: "sam",
            organizationId: "org_acme",
            sessionId: session.id,
          });
          expect(standing.satisfaction.satisfied).toBe(true);
          await expect(
            organization.assertSatisfied({
              userId: "sam",
              organizationId: "org_acme",
              amr: session.amr,
            }),
          ).resolves.toBeUndefined();
        }

        // Nothing was ended by using any of them.
        expect([...live.keys()]).toEqual([
          "before-the-column",
          "ordinary-password",
        ]);
      });

      /** @scenario "Landing the change signs nobody out" */
      it("reads a session that recorded nothing the same way it read one before the column", async () => {
        const organization = organizationAskingNothing();
        const recordedNothing = await organization.standingFor({
          userId: "sam",
          organizationId: "org_acme",
          amr: null,
        });
        const recordedEmpty = await organization.standingFor({
          userId: "sam",
          organizationId: "org_acme",
          amr: [],
        });
        expect(recordedNothing).toEqual(recordedEmpty);
        expect(recordedNothing.required).toBe(false);
      });
    });
  });

  describe("given sessions minted by a password and by an identity provider", () => {
    describe("when the sessions for one of those methods are ended", () => {
      /** @scenario "A session can be ended for one sign-in method alone" */
      /** @scenario "Ending the sessions one sign-in method minted leaves the others alone" */
      it("ends only those, and leaves the others working", async () => {
        const { service, live, deleteByIds, dropTokens } = inventoryOver([
          sessionRow({ id: "password-laptop", identifierId: "id_password" }),
          sessionRow({ id: "password-phone", identifierId: "id_password" }),
          sessionRow({ id: "provider-laptop", identifierId: "id_provider" }),
        ]);

        const result = await service.endSessionsForIdentifier({
          userId: "sam",
          identifierId: "id_password",
        });

        expect(result).toEqual({ ended: 2 });
        expect([...live.keys()]).toEqual(["provider-laptop"]);
        expect(deleteByIds).toHaveBeenCalledWith({
          ids: ["password-laptop", "password-phone"],
        });
        // The cache is cleared for exactly the tokens that stopped working,
        // so there is no window where the row is gone and better-auth still
        // answers from the cache.
        expect(dropTokens).toHaveBeenCalledWith({
          userId: "sam",
          tokens: ["token-password-laptop", "token-password-phone"],
        });
      });

      /** @scenario "A session can be ended for one sign-in method alone" */
      it("ends nothing for an identifier that minted no session", async () => {
        const { service, live, dropTokens } = inventoryOver([
          sessionRow({ id: "password-laptop", identifierId: "id_password" }),
        ]);

        const result = await service.endSessionsForIdentifier({
          userId: "sam",
          identifierId: "id_nobody_holds",
        });

        expect(result).toEqual({ ended: 0 });
        expect([...live.keys()]).toEqual(["password-laptop"]);
        expect(dropTokens).not.toHaveBeenCalled();
      });

      /** @scenario "A session can be ended for one sign-in method alone" */
      /** @scenario "Ending sessions for a sign-in method that is not yours ends nothing" */
      it("ends nothing when the identifier belongs to somebody else", async () => {
        const { service, live } = inventoryOver([
          sessionRow({ id: "password-laptop", identifierId: "id_password" }),
        ]);

        const result = await service.endSessionsForIdentifier({
          userId: "somebody-else",
          identifierId: "id_password",
        });

        expect(result).toEqual({ ended: 0 });
        expect([...live.keys()]).toEqual(["password-laptop"]);
      });
    });

    describe("when one session is ended by name", () => {
      /** @scenario Signing a browser out ends that one and no others */
      it("ends that one and leaves every other signed in", async () => {
        const { service, live, dropTokens } = inventoryOver([
          sessionRow({ id: "office-laptop" }),
          sessionRow({ id: "home-desktop" }),
          sessionRow({ id: "this-browser" }),
        ]);

        const result = await service.endSession({
          userId: "sam",
          sessionId: "office-laptop",
          currentSessionId: "this-browser",
        });

        expect(result).toEqual({ ended: 1 });
        expect([...live.keys()]).toEqual(["home-desktop", "this-browser"]);
        // The cache goes before the row, so there is no window in which the
        // row is gone and better-auth still answers from Redis.
        expect(dropTokens).toHaveBeenCalledWith({
          userId: "sam",
          tokens: ["token-office-laptop"],
        });
      });

      /** @scenario Ending the session doing the asking is refused at the boundary */
      it("refuses to end the session doing the asking, and ends nothing", async () => {
        const { service, live, deleteByIds } = inventoryOver([
          sessionRow({ id: "this-browser" }),
        ]);

        await expect(
          service.endSession({
            userId: "sam",
            sessionId: "this-browser",
            currentSessionId: "this-browser",
          }),
        ).rejects.toMatchObject({ code: "session_is_current" });

        expect([...live.keys()]).toEqual(["this-browser"]);
        expect(deleteByIds).not.toHaveBeenCalled();
      });

      /** @scenario Naming somebody else's session ends nothing */
      it("ends nothing for a session that is not in this person's list", async () => {
        const { service, live, deleteByIds } = inventoryOver([
          sessionRow({ id: "office-laptop" }),
        ]);

        const result = await service.endSession({
          userId: "sam",
          sessionId: "somebody-elses-session",
        });

        expect(result).toEqual({ ended: 0 });
        expect([...live.keys()]).toEqual(["office-laptop"]);
        expect(deleteByIds).not.toHaveBeenCalled();
      });
    });
  });

  describe("when a sign-in mints a session", () => {
    it("records the password a credential sign-in proved", async () => {
      expect(deriveSessionAmr({ path: "/sign-in/email" })).toEqual(["pwd"]);
      expect(signInProviderForPath({ path: "/sign-in/email" })).toBe(
        "credential",
      );
    });

    it("records the password and the code once a challenge is answered", () => {
      expect(deriveSessionAmr({ path: "/two-factor/verify-totp" })).toEqual([
        "pwd",
        "otp",
      ]);
      expect(
        deriveSessionAmr({ path: "/two-factor/verify-backup-code" }),
      ).toEqual(["pwd", "otp"]);
    });

    it("records a passkey as the phishing-resistant proof it is", () => {
      expect(
        deriveSessionAmr({ path: "/passkey/verify-authentication" }),
      ).toEqual(["phw"]);
    });

    it("records the factors an identity provider asserted, and no others", () => {
      expect(
        deriveSessionAmr({
          path: "/callback/auth0",
          providerAssertedAmr: ["pwd", "mfa"],
        }),
      ).toEqual(["oidc", "pwd", "mfa"]);
    });

    it("infers no factor from a provider that asserted none", () => {
      expect(deriveSessionAmr({ path: "/callback/auth0" })).toEqual(["oidc"]);
    });

    it("drops an assertion outside the vocabulary rather than reading it as a factor", () => {
      expect(
        deriveSessionAmr({
          path: "/callback/okta",
          providerAssertedAmr: ["definitely-a-second-factor"],
        }),
      ).toEqual(["oidc"]);
    });

    it("records nothing for a path it does not recognize", () => {
      expect(deriveSessionAmr({ path: "/some/other/endpoint" })).toEqual([]);
    });
  });

  describe("when the claims are resolved for a mint", () => {
    it("names the identifier the provider's sign-in belongs to", async () => {
      const service = new SessionClaimsService({
        identifiers: { findIdentifierIdFor: async () => "id_credential" },
        assertions: { assertedFactorsFor: async () => [] },
      });
      expect(
        await service.claimsForMint({
          userId: "sam",
          path: "/sign-in/email",
        }),
      ).toEqual({ identifierId: "id_credential", amr: ["pwd"] });
    });

    it("asks no identity provider anything on a credential sign-in", async () => {
      const assertedFactorsFor = vi.fn(async () => []);
      const service = new SessionClaimsService({
        identifiers: { findIdentifierIdFor: async () => null },
        assertions: { assertedFactorsFor },
      });
      await service.claimsForMint({ userId: "sam", path: "/sign-in/email" });
      expect(assertedFactorsFor).not.toHaveBeenCalled();
    });

    it("records nothing for a path that mints a session no sign-in made", async () => {
      const service = new SessionClaimsService({
        identifiers: { findIdentifierIdFor: async () => "id_credential" },
        assertions: { assertedFactorsFor: async () => [] },
      });
      expect(
        await service.claimsForMint({ userId: "sam", path: "/get-session" }),
      ).toEqual({ identifierId: null, amr: [] });
    });
  });

  describe("when a session is described to its owner", () => {
    it("says how it signed in without using the wire vocabulary", () => {
      expect(signInMethodLabelFor({ amr: ["pwd", "otp"] })).toBe(
        "Email and password",
      );
      expect(signInMethodLabelFor({ amr: ["phw"] })).toBe("Passkey");
      expect(signInMethodLabelFor({ amr: ["oidc"] })).toBe("Identity provider");
    });

    it("reads a session that proved nothing as an ordinary sign-in", () => {
      expect(signInMethodLabelFor({ amr: [] })).toBe("Signed in");
      expect(signInMethodLabelFor({ amr: null })).toBe("Signed in");
    });
  });
});
