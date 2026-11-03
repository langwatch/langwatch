import { describe, expect, it } from "vitest";

import { SessionCallbackEvidenceChannel } from "../http.session-callback-evidence.channel.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const ISSUER = "https://idp.acme.test";

describe("SessionCallbackEvidenceChannel", () => {
  /** @scenario Simultaneous provider callbacks cannot exchange evidence */
  it("keeps each overlapping request's accepted account to itself", async () => {
    const channel = SessionCallbackEvidenceChannel.create();
    const accept = async ({
      providerId,
      providerAccountId,
    }: {
      providerId: string;
      providerAccountId: string;
    }) =>
      channel.runWithScope(async () => {
        channel.recordAuthenticatedSsoAccount({ providerId, providerAccountId, issuer: ISSUER });
        await tick();
        return channel.findAcceptedAccounts({ providerId });
      });

    const [auth0, okta] = await Promise.all([
      accept({ providerId: "auth0", providerAccountId: "auth0|sam" }),
      accept({ providerId: "okta", providerAccountId: "okta-other" }),
    ]);

    expect(auth0.map((entry) => entry.providerAccountId)).toEqual(["auth0|sam"]);
    expect(okta.map((entry) => entry.providerAccountId)).toEqual(["okta-other"]);
    expect([...auth0, ...okta].every((entry) => entry.assertedFactors.length === 0)).toBe(true);
  });

  /** @scenario Unbound token claims earn no authentication credit */
  it("records the accepted account with no asserted factors and no verified claims", () => {
    const channel = SessionCallbackEvidenceChannel.create();
    return channel.runWithScope(async () => {
      channel.recordAuthenticatedSsoAccount({
        providerId: "auth0",
        providerAccountId: "auth0|sam",
        issuer: ISSUER,
      });

      expect(channel.findAcceptedAccounts({ providerId: "auth0" })).toEqual([
        {
          providerId: "auth0",
          providerAccountId: "auth0|sam",
          assertedFactors: [],
          verifiedTokenClaims: false,
        },
      ]);
      expect(channel.findAcceptedAccounts({ providerId: "okta" })).toEqual([]);
    });
  });

  describe("when the SSO seam admitted a subject", () => {
    /** @scenario A single sign-on account row carries the issuer its assertion was verified under */
    it("keeps the issuer that subject was verified under for its account row", () => {
      const channel = SessionCallbackEvidenceChannel.create();
      return channel.runWithScope(async () => {
        channel.recordAuthenticatedSsoAccount({
          providerId: "acme-oidc",
          providerAccountId: "sam-subject",
          issuer: ISSUER,
        });

        expect(
          channel.findAssertedIssuers({
            providerId: "acme-oidc",
            providerAccountId: "sam-subject",
          }),
        ).toEqual([ISSUER]);
      });
    });

    /** @scenario The issuer one subject was verified under is never stamped on another */
    it.each([
      ["another subject", { providerId: "acme-oidc", providerAccountId: "other-subject" }],
      ["another connection", { providerId: "beta-oidc", providerAccountId: "sam-subject" }],
    ])("finds no issuer for %s", (_name, account) => {
      const channel = SessionCallbackEvidenceChannel.create();
      return channel.runWithScope(async () => {
        channel.recordAuthenticatedSsoAccount({
          providerId: "acme-oidc",
          providerAccountId: "sam-subject",
          issuer: ISSUER,
        });

        expect(channel.findAssertedIssuers(account)).toEqual([]);
      });
    });
  });

  it("finds nothing outside a request scope", () => {
    const channel = SessionCallbackEvidenceChannel.create();
    channel.recordAuthenticatedSsoAccount({
      providerId: "auth0",
      providerAccountId: "auth0|sam",
      issuer: ISSUER,
    });

    expect(channel.findAcceptedAccounts({ providerId: "auth0" })).toEqual([]);
  });

  describe("when a deployment Okta or Auth0 callback verified an ID token", () => {
    const token = (claims: Record<string, unknown>) =>
      `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;

    /** @scenario A deployment Okta or Auth0 callback carries its verified token's factors to the session */
    it("carries the token's amr onto the accepted account with the same subject", () => {
      const channel = SessionCallbackEvidenceChannel.create();
      return channel.runWithScope(async () => {
        const path = "/oauth2/callback/okta";
        channel.recordVerifiedCallbackToken({
          providerId: "okta",
          path,
          verifiedIdToken: token({ sub: "00usam", amr: ["pwd", "mfa"] }),
        });
        channel.recordAuthenticatedCallbackAccount({
          providerId: "okta",
          providerAccountId: "00usam",
          path,
        });

        expect(channel.findAcceptedAccounts({ providerId: "okta" })).toEqual([
          {
            providerId: "okta",
            providerAccountId: "00usam",
            assertedFactors: ["pwd", "mfa"],
            verifiedTokenClaims: true,
          },
        ]);
      });
    });

    /** @scenario A deployment Okta or Auth0 callback carries its verified token's factors to the session */
    it("earns nothing for another subject or another provider's callback path", () => {
      const channel = SessionCallbackEvidenceChannel.create();
      return channel.runWithScope(async () => {
        channel.recordVerifiedCallbackToken({
          providerId: "auth0",
          path: "/oauth2/callback/okta",
          verifiedIdToken: token({ sub: "auth0|sam", amr: ["mfa"] }),
        });
        channel.recordVerifiedCallbackToken({
          providerId: "okta",
          path: "/oauth2/callback/okta",
          verifiedIdToken: token({ sub: "00uother", amr: ["mfa"] }),
        });
        channel.recordAuthenticatedCallbackAccount({
          providerId: "okta",
          providerAccountId: "00usam",
          path: "/oauth2/callback/okta",
        });

        expect(channel.findAcceptedAccounts({ providerId: "okta" })).toEqual([
          {
            providerId: "okta",
            providerAccountId: "00usam",
            assertedFactors: [],
            verifiedTokenClaims: false,
          },
        ]);
        expect(channel.findAcceptedAccounts({ providerId: "auth0" })).toEqual([]);
      });
    });
  });
});
