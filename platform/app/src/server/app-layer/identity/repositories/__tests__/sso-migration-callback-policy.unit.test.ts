import { describe, expect, it } from "vitest";
import {
  legacyAuthenticationIsRetired,
  legacyCallbackMatches,
  ssoCallbackProviderFromPath,
} from "../sso-migration-callback-policy.prisma.repository";

describe("legacy Auth0 callback provenance", () => {
  const account = {
    provider: "auth0",
    providerAccountId: "waad|acme-connection|user-123",
  };

  it("separates the mounted callback provider from the organization subject prefix", () => {
    const callback = ssoCallbackProviderFromPath(
      "/oauth2/callback/auth0?code=redacted",
    );

    expect(callback).toEqual({ kind: "legacy", providerId: "auth0" });
    expect(
      legacyCallbackMatches({
        callbackProviderId: callback?.providerId ?? "",
        legacyProviderId: "waad|acme-connection",
        account,
      }),
    ).toBe(true);
  });

  it("does not confuse a sibling organization's subject prefix", () => {
    expect(
      legacyCallbackMatches({
        callbackProviderId: "auth0",
        legacyProviderId: "waad|acme",
        account,
      }),
    ).toBe(false);
  });

  it("allows grace activity and closes the callback at finalization", () => {
    expect(legacyAuthenticationIsRetired("GRACE_LEGACY")).toBe(false);
    expect(legacyAuthenticationIsRetired("GRACE_DIRECT")).toBe(false);
    expect(legacyAuthenticationIsRetired("FINALIZING")).toBe(true);
    expect(legacyAuthenticationIsRetired("FINALIZED")).toBe(true);
  });
});
