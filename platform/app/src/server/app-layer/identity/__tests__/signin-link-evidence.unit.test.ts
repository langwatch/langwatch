/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { SignInLinkEvidence } from "../signin-link-evidence";

/**
 * ADR-117 §3's rule at the seam that actually runs it.
 *
 * `signin-callback-linking.service.unit.test.ts` covers the same rule through
 * the service that owns a whole callback — which no deployment reaches,
 * because the identity library owns callback resolution on all of them. These
 * cover the path a real sign-in takes.
 */

const idTokenAsserting = (claims: Record<string, unknown>): string =>
  [
    Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "signature-not-checked-here",
  ].join(".");

const evidenceOver = ({
  emailVerified,
  accountCount,
  proposeLink = vi.fn().mockResolvedValue([]),
}: {
  emailVerified: boolean;
  accountCount: number;
  proposeLink?: ReturnType<typeof vi.fn>;
}) => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ emailVerified }) },
    account: { count: vi.fn().mockResolvedValue(accountCount) },
  } as unknown as PrismaClient;

  return {
    proposeLink,
    evidence: new SignInLinkEvidence({
      prisma,
      proposeLink: proposeLink as never,
      now: () => 1_700_000_000_000,
      newCommandId: () => "idcmd_test",
      newProposalId: () => "idlink_test",
    }),
  };
};

const link = {
  userId: "user_1",
  providerId: "google",
  providerAccountId: "google-sub-1",
};

describe("given somebody who already signs in one way", () => {
  describe("when a second method's provider says the address is not verified", () => {
    /** @scenario "The evidence rule also guards a method added to an established account" */
    it("refuses the attachment and records a proposal an admin can resolve", async () => {
      const { evidence, proposeLink } = evidenceOver({
        emailVerified: true,
        accountCount: 1,
      });

      const refusal = await evidence.refusalForLink({
        ...link,
        idToken: idTokenAsserting({
          email: "sam@acme.test",
          email_verified: false,
        }),
      });

      expect(refusal).toBe("unverified_orphan");
      expect(proposeLink).toHaveBeenCalledTimes(1);
      expect(proposeLink.mock.calls[0]?.[0]).toMatchObject({
        userId: "user_1",
        proposalId: "idlink_test",
        reason: "unverified_orphan",
        value: "sam@acme.test",
        // No connection exists at this seam, so the proposal says so rather
        // than inventing one.
        connectionId: null,
        actor: { type: "system", id: null },
      });
    });
  });

  describe("when the provider makes no claim about the address", () => {
    /** @scenario "An identity provider that asserts nothing refuses nothing" */
    it.each([
      ["no token at all", undefined],
      ["a token with no claims", idTokenAsserting({})],
      [
        "an address with no verification claim beside it",
        idTokenAsserting({ email: "sam@acme.test" }),
      ],
      ["an unparsable token", "not.a.jwt"],
    ])("attaches as before, given %s", async (_name, idToken) => {
      const { evidence, proposeLink } = evidenceOver({
        emailVerified: false,
        accountCount: 1,
      });

      expect(await evidence.refusalForLink({ ...link, idToken })).toBeNull();
      expect(proposeLink).not.toHaveBeenCalled();
    });
  });

  describe("when both sides say the address is verified", () => {
    it("attaches the method", async () => {
      const { evidence, proposeLink } = evidenceOver({
        emailVerified: true,
        accountCount: 1,
      });

      const refusal = await evidence.refusalForLink({
        ...link,
        idToken: idTokenAsserting({
          email: "sam@acme.test",
          email_verified: true,
        }),
      });

      expect(refusal).toBeNull();
      expect(proposeLink).not.toHaveBeenCalled();
    });
  });
});

describe("given somebody with no sign-in method yet", () => {
  describe("when a first method's provider says the address is not verified", () => {
    it("judges nothing, leaving the orphan rule to the callback that owns it", async () => {
      const { evidence, proposeLink } = evidenceOver({
        emailVerified: false,
        accountCount: 0,
      });

      // Deliberately NOT a refusal. A person with no accounts is either brand
      // new or an orphan row, and the identity library already refuses to
      // link an unverified orphan — bound against a real callback in
      // `generic-oauth-id-token-verification.integration.test.ts`. Refusing
      // here as well would only add a way to lock a new signup out.
      expect(
        await evidence.refusalForLink({
          ...link,
          idToken: idTokenAsserting({
            email: "sam@acme.test",
            email_verified: false,
          }),
        }),
      ).toBeNull();
      expect(proposeLink).not.toHaveBeenCalled();
    });
  });
});

describe("given the proposal cannot be written", () => {
  describe("when the evidence refuses the link", () => {
    it("still refuses, because the refusal is the security answer", async () => {
      const { evidence } = evidenceOver({
        emailVerified: true,
        accountCount: 1,
        proposeLink: vi.fn().mockRejectedValue(new Error("ledger unavailable")),
      });

      await expect(
        evidence.refusalForLink({
          ...link,
          idToken: idTokenAsserting({
            email: "sam@acme.test",
            email_verified: false,
          }),
        }),
      ).resolves.toBe("unverified_orphan");
    });
  });
});
