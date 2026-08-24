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
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
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
  cognitoIssuer:
    "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123",
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

    /**
     * Reads the router source rather than booting it: `createApiRouter` pulls
     * in the whole API surface (prisma, redis, every route module), which a
     * unit test must not pay for. The registration is a loop over the exported
     * list, so what matters is that it is still driven by that list and has not
     * been unrolled back into hand-written per-provider lines.
     */
    it("registers the rewrites from that same list, not by hand", async () => {
      const source = await readFile(
        new URL(
          "../../../../../../platform/app/src/server/api-router.ts",
          import.meta.url,
        ),
        "utf8",
      );

      expect(source).toContain("LEGACY_CALLBACK_PROVIDER_IDS");
      expect(source).toContain("rewriteCallback(provider)");

      // A hand-written registration for a single provider is what drifted
      // before, so it must not come back.
      for (const providerId of LEGACY_CALLBACK_PROVIDER_IDS) {
        expect(source).not.toContain(`.all("/${providerId}", rewriteCallback(`);
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
