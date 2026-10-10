import { describe, expect, it } from "vitest";

import { SessionCallbackEvidenceChannel } from "../http.session-callback-evidence.channel.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
        channel.recordAuthenticatedSsoAccount({ providerId, providerAccountId });
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

  it("finds nothing outside a request scope", () => {
    const channel = SessionCallbackEvidenceChannel.create();
    channel.recordAuthenticatedSsoAccount({ providerId: "auth0", providerAccountId: "auth0|sam" });

    expect(channel.findAcceptedAccounts({ providerId: "auth0" })).toEqual([]);
  });
});
