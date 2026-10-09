import { describe, expect, it } from "vitest";
import {
  legacyAuthenticationIsRetired,
  legacyCallbackMatches,
  migrationAuthenticationDecision,
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

  it("keeps an exact legacy binding usable in SETUP without ownership proof", () => {
    expect(
      migrationAuthenticationDecision({
        callback: { kind: "legacy", providerId: "auth0" },
        account,
        pairs: [
          {
            legacy: {
              id: "ssoc_legacy",
              organizationId: "org_acme",
              providerId: "waad|acme-connection",
            },
            replacement: {
              id: "local_ssoc_replacement",
              organizationId: "org_acme",
              migrationPhase: "SETUP",
            },
          },
        ],
      }),
    ).toEqual({
      action: "record",
      connection: { id: "ssoc_legacy", organizationId: "org_acme" },
    });
  });

  it("does not treat an unknown direct subject as an existing binding", () => {
    expect(
      migrationAuthenticationDecision({
        callback: { kind: "direct", providerId: "local_ssoc_replacement" },
        account,
        pairs: [
          {
            legacy: {
              id: "ssoc_legacy",
              organizationId: "org_acme",
              providerId: "waad|acme-connection",
            },
            replacement: {
              id: "local_ssoc_replacement",
              organizationId: "org_acme",
              migrationPhase: "GRACE_DIRECT",
            },
          },
        ],
      }),
    ).toEqual({
      action: "reject",
      code: "SSO_MIGRATION_AUTH_NOT_ALLOWED",
    });
  });

  it("matches only the account accepted by this callback", () => {
    expect(
      migrationAuthenticationDecision({
        callback: { kind: "legacy", providerId: "auth0" },
        account: {
          provider: "auth0",
          providerAccountId: "waad|acme-connection|user-123",
        },
        pairs: [
          {
            legacy: {
              id: "ssoc_acme_legacy",
              organizationId: "org_acme",
              providerId: "waad|acme-connection",
            },
            replacement: {
              id: "ssoc_acme_direct",
              organizationId: "org_acme",
              migrationPhase: "GRACE_LEGACY",
            },
          },
          {
            legacy: {
              id: "ssoc_other_legacy",
              organizationId: "org_other",
              providerId: "waad|other-connection",
            },
            replacement: {
              id: "ssoc_other_direct",
              organizationId: "org_other",
              migrationPhase: "GRACE_LEGACY",
            },
          },
        ],
      }),
    ).toEqual({
      action: "record",
      connection: { id: "ssoc_acme_legacy", organizationId: "org_acme" },
    });
  });
});
