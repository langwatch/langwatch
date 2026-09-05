// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The two provider modes an operator names by hand: auth0, which is an OIDC
 * provider carrying a legacy callback path, and google, which is a social
 * provider. Both are decided by the provider name, not by which credentials
 * happen to be present.
 *
 * Covers specs/auth/phase-1-better-auth-config.feature.
 */
import { describe, expect, it } from "vitest";

import { buildGenericOAuthConfigs, buildSocialProviders } from "../better-auth.better-auth.adapter";

const BASE_URL = "http://localhost:3000";

const auth0Configuration = {
  provider: "auth0",
  baseUrl: BASE_URL,
  auth0ClientId: "auth0-client-id",
  auth0ClientSecret: "auth0-client-secret",
  auth0Issuer: "tenant.us.auth0.com",
};

describe("given a deployment that names auth0", () => {
  describe("when the OIDC providers are built", () => {
    /** @scenario Auth0 enterprise mode */
    it("mounts auth0 on the legacy callback path auth0 has registered", () => {
      const configs = buildGenericOAuthConfigs(auth0Configuration);
      const auth0 = configs.find((c) => (c as { providerId?: string }).providerId === "auth0") as
        | { redirectURI?: string }
        | undefined;

      expect(configs.map((c) => (c as { providerId?: string }).providerId)).toContain("auth0");
      // Auth0 only has the legacy path registered as an allowed callback;
      // sending a different redirect_uri makes it reject the authorization
      // request outright.
      expect(auth0?.redirectURI).toBe(`${BASE_URL}/api/auth/callback/auth0`);
    });

    /** @scenario Credentials-only on-prem mode */
    it("mounts no social provider, because only the named provider is configured", () => {
      expect(buildSocialProviders({ provider: "email" })).toEqual({});
    });
  });
});

describe("given a deployment that names google", () => {
  describe("when the social providers are built", () => {
    /** @scenario Google mode */
    it("mounts google with the credentials the deployment supplied", () => {
      const socialProviders = buildSocialProviders({
        provider: "google",
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      });

      const google = socialProviders.google as
        | { clientId?: string; clientSecret?: string }
        | undefined;

      expect(google).toBeDefined();
      // Credentials must be threaded through from configuration, not merely present.
      expect(google?.clientId).toBe("google-client-id");
      expect(google?.clientSecret).toBe("google-client-secret");
    });
  });
});
