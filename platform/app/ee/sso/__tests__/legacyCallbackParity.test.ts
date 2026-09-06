// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every generic-OAuth provider pins its `redirectURI` to
 * `/api/auth/callback/<providerId>` — the URL self-hosting operators register
 * with their IdP, and the one customer IdPs have had on file for years.
 *
 * It was called the LEGACY path because better-auth's genericOAuth plugin used
 * to answer at `/api/auth/oauth2/callback/<providerId>` instead, and
 * `createApiRouter` rewrote one to the other. Since better-auth 1.7 the plugin
 * mounts no endpoints at all — each config is registered as a first-class
 * social provider — so the core callback answers this path directly, the
 * rewrite is gone, and the "legacy" URL is simply the URL.
 *
 * What still has to hold is the pin itself, both ways: a provider that builds
 * a config without pinning would send its IdP to whatever better-auth defaults
 * to, and a provider added to the OIDC table but missing from the id list
 * would never be checked at all. Both fail quietly — sign-in keeps working for
 * every provider except the one that drifted.
 */
import { describe, expect, it } from "vitest";
import {
  buildGenericOAuthConfigs,
  LEGACY_CALLBACK_PROVIDER_IDS,
  legacyCallbackUrl,
  PLAIN_OIDC_PROVIDERS,
} from "../providers";

const BASE_URL = "https://langwatch.acme.test";

/**
 * Credentials for every provider at once. `buildGenericOAuthConfigs` only ever
 * emits the one named by `NEXTAUTH_PROVIDER`, so this is asked once per id.
 */
const envFor = (provider: string) => ({
  NEXTAUTH_PROVIDER: provider,
  NEXTAUTH_URL: BASE_URL,
  AUTH0_CLIENT_ID: "id",
  AUTH0_CLIENT_SECRET: "secret",
  AUTH0_ISSUER: "https://tenant.us.auth0.com",
  OKTA_CLIENT_ID: "id",
  OKTA_CLIENT_SECRET: "secret",
  OKTA_ISSUER: "https://acme.okta.com",
  COGNITO_CLIENT_ID: "id",
  COGNITO_CLIENT_SECRET: "secret",
  COGNITO_ISSUER:
    "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123",
  ONELOGIN_CLIENT_ID: "id",
  ONELOGIN_CLIENT_SECRET: "secret",
  ONELOGIN_ISSUER: "https://acme.onelogin.com/oidc/2",
  OIDC_CLIENT_ID: "id",
  OIDC_CLIENT_SECRET: "secret",
  OIDC_ISSUER: "https://idp.acme.test",
});

/**
 * Whether a provider pins the legacy callback path, read off the config it
 * actually builds rather than restated here.
 */
const pinsTheLegacyPath = (providerId: string): boolean => {
  const config = buildGenericOAuthConfigs(envFor(providerId)).find(
    (c) => (c as { providerId?: string }).providerId === providerId,
  ) as { redirectURI?: string } | undefined;

  return (
    config?.redirectURI === legacyCallbackUrl({ baseUrl: BASE_URL, providerId })
  );
};

describe("legacy callback rewrites", () => {
  describe("given the generic-OAuth providers this build ships", () => {
    it.each([
      ...LEGACY_CALLBACK_PROVIDER_IDS,
    ])("pins %s to the legacy callback path, so its rewrite is the one that serves it", (providerId) => {
      expect(pinsTheLegacyPath(providerId)).toBe(true);
    });

    /**
     * The inverse: a provider that builds a config but is missing from the
     * list would have no rewrite, which is the drift this file exists for.
     * `PLAIN_OIDC_PROVIDERS` is the table new providers get added to, so
     * every id in it has to appear.
     */
    it("covers every provider in the OIDC table", () => {
      for (const provider of PLAIN_OIDC_PROVIDERS) {
        expect(LEGACY_CALLBACK_PROVIDER_IDS).toContain(provider.providerId);
      }
    });
  });

  describe("given a provider id", () => {
    it("builds the callback URL the self-hosting docs tell operators to register", () => {
      expect(
        legacyCallbackUrl({ baseUrl: BASE_URL, providerId: "cognito" }),
      ).toBe("https://langwatch.acme.test/api/auth/callback/cognito");
    });
  });
});
