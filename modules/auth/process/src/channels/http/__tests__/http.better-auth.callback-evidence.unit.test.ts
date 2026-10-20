import { describe, expect, it } from "vitest";

import { recordCallbackAccount, recordCallbackEvidence } from "../http.better-auth.channel.ts";
import { SessionCallbackEvidenceChannel } from "../http.session-callback-evidence.channel.ts";

const token = (claims: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;

const context = { path: "/oauth2/callback/:providerId", params: { providerId: "okta" } };

describe("the account hooks' callback evidence", () => {
  describe("when a returning Okta user signs in and Better Auth refreshes the linked account", () => {
    /** @scenario A deployment Okta or Auth0 callback carries its verified token's factors to the session */
    it("carries the token's amr once the updated row names the account", () => {
      const evidence = SessionCallbackEvidenceChannel.create();
      return evidence.runWithScope(async () => {
        recordCallbackEvidence({
          evidence,
          account: { providerId: "okta", idToken: token({ sub: "00usam", amr: ["pwd", "mfa"] }) },
          context,
        });
        expect(evidence.findAcceptedAccounts({ providerId: "okta" })).toEqual([]);

        recordCallbackAccount({
          evidence,
          account: { providerId: "okta", accountId: "00usam" },
          context,
        });

        expect(evidence.findAcceptedAccounts({ providerId: "okta" })).toEqual([
          {
            providerId: "okta",
            providerAccountId: "00usam",
            assertedFactors: ["pwd", "mfa"],
            verifiedTokenClaims: true,
          },
        ]);
      });
    });

    it("earns nothing when the updated row belongs to another subject", () => {
      const evidence = SessionCallbackEvidenceChannel.create();
      return evidence.runWithScope(async () => {
        recordCallbackEvidence({
          evidence,
          account: { providerId: "okta", idToken: token({ sub: "00usam", amr: ["pwd", "mfa"] }) },
          context,
        });
        recordCallbackAccount({
          evidence,
          account: { providerId: "okta", accountId: "00uother" },
          context,
        });

        expect(evidence.findAcceptedAccounts({ providerId: "okta" })).toEqual([
          {
            providerId: "okta",
            providerAccountId: "00uother",
            assertedFactors: [],
            verifiedTokenClaims: false,
          },
        ]);
      });
    });
  });
});
