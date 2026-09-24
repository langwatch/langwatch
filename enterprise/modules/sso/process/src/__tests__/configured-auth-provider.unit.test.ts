import { configuredAuthProvider } from "@langwatch/enterprise-sso-contract/sign-in-providers";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

describe("configuredAuthProvider", () => {
  it("reads AUTH_PROVIDER without a word of complaint", () => {
    expect(configuredAuthProvider({ authProvider: "auth0", legacyProvider: undefined })).toEqual({
      provider: "auth0",
      deprecatedNameUsed: false,
    });
  });

  it("still applies NEXTAUTH_PROVIDER, and says it is the deprecated name", () => {
    expect(configuredAuthProvider({ authProvider: undefined, legacyProvider: "auth0" })).toEqual({
      provider: "auth0",
      deprecatedNameUsed: true,
    });
  });

  it("lets AUTH_PROVIDER win when both are set", () => {
    expect(configuredAuthProvider({ authProvider: "okta", legacyProvider: "auth0" })).toEqual({
      provider: "okta",
      deprecatedNameUsed: false,
    });
  });

  it("means email when neither is set", () => {
    expect(
      configuredAuthProvider({ authProvider: undefined, legacyProvider: undefined }).provider,
    ).toBe("email");
  });
});
