import { describe, expect, it } from "vitest";
import { VerifiedCallbackProviderAssertions } from "../session-adapters";
import {
  SessionClaimsService,
  type SessionIdentifierPort,
} from "../session-claims.service";

const identifiers = ({
  answer,
}: {
  answer: string | null;
}): SessionIdentifierPort & {
  calls: Array<{
    userId: string;
    providerId: string;
    providerAccountId?: string;
  }>;
} => {
  const calls: Array<{
    userId: string;
    providerId: string;
    providerAccountId?: string;
  }> = [];

  return {
    calls,
    findIdentifierIdFor: async (args) => {
      calls.push(args);
      return answer;
    },
  };
};

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
};

const verifiedIdToken = (claims: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("session claims from an identity-provider callback", () => {
  /** @scenario An enterprise callback records the exact accepted account */
  it.each([
    ["auth0", "auth0|sam", "identifier_auth0"],
    ["okta", "okta-user-sam", "identifier_okta"],
  ])("attributes a %s session to the exact authenticated account", async (providerId, providerAccountId, identifierId) => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const identifierPort = identifiers({ answer: identifierId });
    const claims = new SessionClaimsService({
      identifiers: identifierPort,
      assertions,
    });

    const result = await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId,
        path: `/callback/${providerId}`,
        verifiedIdToken: verifiedIdToken({ sub: providerAccountId }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId,
        providerAccountId,
        path: `/callback/${providerId}`,
      });
      return claims.claimsForMint({
        userId: "user_sam",
        path: `/callback/${providerId}`,
      });
    });

    expect(result.identifierId).toBe(identifierId);
    expect(identifierPort.calls).toEqual([
      { userId: "user_sam", providerId, providerAccountId },
    ]);
  });

  /** @scenario Current verified Auth0 factors are recorded on the new session */
  it("carries the current verified profile's AMR into the new session", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const claims = new SessionClaimsService({
      identifiers: identifiers({ answer: "identifier_auth0" }),
      assertions,
    });

    const result = await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/callback/auth0",
        verifiedIdToken: verifiedIdToken({
          sub: "auth0|sam",
          amr: ["pwd", "otp", "unknown"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });
      return claims.claimsForMint({
        userId: "user_sam",
        path: "/callback/auth0",
      });
    });

    expect(result.amr).toEqual(["oidc", "pwd", "otp"]);
  });

  /** @scenario A stored MFA assertion cannot speak for a later callback */
  it("does not reuse a stale MFA assertion when the current callback asserted none", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const claims = new SessionClaimsService({
      identifiers: identifiers({ answer: "identifier_auth0" }),
      assertions,
    });

    await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/callback/auth0",
        verifiedIdToken: verifiedIdToken({
          sub: "auth0|sam",
          amr: ["pwd", "otp"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });
      expect(
        await claims.claimsForMint({
          userId: "user_sam",
          path: "/callback/auth0",
        }),
      ).toMatchObject({ amr: ["oidc", "pwd", "otp"] });
    });

    const current = await assertions.runWithScope(async () => {
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });
      return claims.claimsForMint({
        userId: "user_sam",
        path: "/callback/auth0",
      });
    });

    expect(current).toEqual({ identifierId: "identifier_auth0", amr: [] });
  });

  /** @scenario Simultaneous provider callbacks cannot exchange evidence */
  it("isolates simultaneous callbacks and their provider subjects", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const firstRecorded = deferred();
    const secondRecorded = deferred();

    const auth0 = assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/callback/auth0",
        verifiedIdToken: verifiedIdToken({
          sub: "auth0|sam",
          amr: ["otp"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });
      firstRecorded.resolve();
      await secondRecorded.promise;
      return assertions.authenticatedAccountFor({ providerId: "auth0" });
    });

    const okta = assertions.runWithScope(async () => {
      await firstRecorded.promise;
      assertions.recordVerifiedCallbackToken({
        providerId: "okta",
        path: "/callback/okta",
        verifiedIdToken: verifiedIdToken({ sub: "okta-sam", amr: [] }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "okta",
        providerAccountId: "okta-sam",
        path: "/callback/okta",
      });
      secondRecorded.resolve();
      return assertions.authenticatedAccountFor({ providerId: "okta" });
    });

    await expect(Promise.all([auth0, okta])).resolves.toEqual([
      {
        providerAccountId: "auth0|sam",
        assertedFactors: ["otp"],
        verifiedTokenClaims: true,
      },
      {
        providerAccountId: "okta-sam",
        assertedFactors: [],
        verifiedTokenClaims: true,
      },
    ]);
  });

  /** @scenario Unbound token claims earn no authentication credit */
  it("ignores verified evidence for a different callback provider", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();

    await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/callback/auth0",
        verifiedIdToken: verifiedIdToken({
          sub: "auth0|sam",
          amr: ["otp"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });

      await expect(
        assertions.authenticatedAccountFor({ providerId: "okta" }),
      ).resolves.toBeNull();
    });
  });

  /** @scenario Unbound token claims earn no authentication credit */
  it("never reads AMR from an unverified request token", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const rawRequestToken = verifiedIdToken({
      sub: "auth0|sam",
      amr: ["otp"],
    });

    await assertions.runWithScope(async () => {
      // The database hook is the only production caller, and it passes the
      // token only on BetterAuth's post-verification callback path. A token
      // merely present on any other request earns no evidence.
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/sign-in/social",
        verifiedIdToken: rawRequestToken,
      });

      await expect(
        assertions.authenticatedAccountFor({ providerId: "auth0" }),
      ).resolves.toBeNull();
    });
  });

  /** @scenario Unbound token claims earn no authentication credit */
  it("attributes other accepted provider accounts without trusting their token claims", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const identifierPort = identifiers({ answer: "identifier_google" });
    const claims = new SessionClaimsService({
      identifiers: identifierPort,
      assertions,
    });

    const result = await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "google",
        path: "/callback/google",
        verifiedIdToken: verifiedIdToken({
          sub: "google-sam",
          amr: ["otp"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "google",
        providerAccountId: "google-sam",
        path: "/callback/google",
      });

      return claims.claimsForMint({
        userId: "user_sam",
        path: "/callback/google",
      });
    });

    expect(result).toEqual({ identifierId: "identifier_google", amr: [] });
    expect(identifierPort.calls).toEqual([
      {
        userId: "user_sam",
        providerId: "google",
        providerAccountId: "google-sam",
      },
    ]);
  });

  /** @scenario Unbound token claims earn no authentication credit */
  it("does not trust verified token claims for a different accepted subject", async () => {
    const assertions = new VerifiedCallbackProviderAssertions();
    const claims = new SessionClaimsService({
      identifiers: identifiers({ answer: "identifier_auth0" }),
      assertions,
    });

    const result = await assertions.runWithScope(async () => {
      assertions.recordVerifiedCallbackToken({
        providerId: "auth0",
        path: "/callback/auth0",
        verifiedIdToken: verifiedIdToken({
          sub: "auth0|attacker",
          amr: ["otp"],
        }),
      });
      assertions.recordAuthenticatedCallbackAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        path: "/callback/auth0",
      });

      return claims.claimsForMint({
        userId: "user_sam",
        path: "/callback/auth0",
      });
    });

    expect(result).toEqual({ identifierId: "identifier_auth0", amr: [] });
  });
});
