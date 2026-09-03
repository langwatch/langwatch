// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every generic-OAuth provider pins its `redirectURI` to the legacy
 * `/api/auth/callback/<providerId>` path, and `createApiRouter` has to rewrite
 * that path to the genericOAuth plugin's own callback for each of them.
 *
 * The two lived apart until a provider was added to one and not the other. The
 * failure is quiet rather than loud: the round-trip still lands on the
 * `/api/auth/*` catch-all and better-auth's core social callback picks it up
 * from `ctx.socialProviders`, so sign-in appears to work while taking a
 * different code path from the providers that are rewritten. Nothing else in
 * the suite notices, because everything it asserts still holds.
 *
 * So this asserts the two halves agree, both ways.
 */
import { describe, expect, it } from "vitest";
import * as ssoServer from "@langwatch/enterprise-sso-server";
import {
  buildGenericOAuthConfigs,
  LEGACY_CALLBACK_PROVIDER_IDS,
  legacyCallbackUrl,
  PLAIN_OIDC_PROVIDERS,
} from "@langwatch/enterprise-sso-server";

const BASE_URL = "https://langwatch.acme.test";

/**
 * Credentials for every provider at once. `buildGenericOAuthConfigs` only ever
 * emits the one named by `provider`, so this is asked once per id.
 */
const envFor = (provider: string) => ({
  provider: provider,
  baseUrl: BASE_URL,
  auth0ClientId: "id",
  auth0ClientSecret: "secret",
  auth0Issuer: "https://tenant.us.auth0.com",
  oktaClientId: "id",
  oktaClientSecret: "secret",
  oktaIssuer: "https://acme.okta.com",
  cognitoClientId: "id",
  cognitoClientSecret: "secret",
  cognitoIssuer: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123",
  oneLoginClientId: "id",
  oneLoginClientSecret: "secret",
  oneLoginIssuer: "https://acme.onelogin.com/oidc/2",
  oidcClientId: "id",
  oidcClientSecret: "secret",
  oidcIssuer: "https://idp.acme.test",
});

/**
 * Whether a provider pins the legacy callback path, read off the config it
 * actually builds rather than restated here.
 */
const pinsTheLegacyPath = (providerId: string): boolean => {
  const config = buildGenericOAuthConfigs(envFor(providerId)).find(
    (c) => (c as { providerId?: string }).providerId === providerId,
  ) as { redirectURI?: string } | undefined;

  return config?.redirectURI === legacyCallbackUrl({ baseUrl: BASE_URL, providerId });
};

describe("legacy callback rewrites", () => {
  describe("given the generic-OAuth providers this build ships", () => {
    it.each([...LEGACY_CALLBACK_PROVIDER_IDS])(
      "pins %s to the legacy callback path, so its rewrite is the one that serves it",
      (providerId) => {
        expect(pinsTheLegacyPath(providerId)).toBe(true);
      },
    );

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

    /**
     * This package ships no rewrite of its own, which is the other half of the
     * pin: a provider is served at the legacy path because its config names
     * that path, and the only thing that could break that is a route rewriting
     * the callback out from under it.
     *
     * It used to be checked by READING the router that mounted better-auth and
     * asserting no `rewriteCallback` appeared in it. That router was
     * `platform/app/src/server/api-router.ts`, which no longer exists — the
     * process that mounts the auth catch-all is a different workspace now, and
     * a test in this package reaching across into a sibling app's source is
     * exactly the guard that dies on the next move. So what is pinned here is
     * the fact this package OWNS: no rewriting helper leaves it. A rewrite
     * mounted by a process is that process's own regression test to write.
     */
    it("ships no callback rewrite of its own, which is what would break the pin", () => {
      expect(Object.keys(ssoServer).filter((name) => /rewrite/i.test(name))).toEqual([]);
    });
  });

  describe("given a provider id", () => {
    it("builds the callback URL the self-hosting docs tell operators to register", () => {
      expect(legacyCallbackUrl({ baseUrl: BASE_URL, providerId: "cognito" })).toBe(
        "https://langwatch.acme.test/api/auth/callback/cognito",
      );
    });
  });
});
