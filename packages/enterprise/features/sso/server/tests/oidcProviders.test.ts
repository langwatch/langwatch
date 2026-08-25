// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cognito and OneLogin are configured from a client id, a client secret and an
 * issuer, with every endpoint read from the issuer's OIDC discovery document.
 * These tests pin that contract: which provider mounts for a given
 * provider, what discovery URL the issuer turns into, and the callback
 * URL an operator has to register with their identity provider.
 *
 * Covers specs/auth/sso-oidc-providers.feature.
 */
import { describe, expect, it } from "vitest";
import {
  buildGenericOAuthConfigs,
  discoveryUrlFor,
  fallbackName,
  PLAIN_OIDC_PROVIDERS,
} from "../src/adapters/better-auth.better-auth.adapter";

const BASE_URL = "https://langwatch.acme.test";

/**
 * Taken from the provider table rather than listed here, so a provider added
 * there is covered without anyone remembering to come back.
 */
const PLAIN_OIDC_PROVIDER_IDS = PLAIN_OIDC_PROVIDERS.map((p) => p.providerId);

const cognitoIssuer =
  "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123";
const oneLoginIssuer = "https://acme.onelogin.com/oidc/2";

/**
 * A deployment env with both providers' credentials present. Individual tests
 * flip `provider` or drop a credential. The point of most of these is
 * that having credentials lying around is not what decides which provider
 * mounts.
 */
const envWith = (overrides: Record<string, string | undefined>) => ({
  provider: "email",
  baseUrl: BASE_URL,
  cognitoClientId: "cognito-client-id",
  cognitoClientSecret: "cognito-client-secret",
  cognitoIssuer,
  oneLoginClientId: "onelogin-client-id",
  oneLoginClientSecret: "onelogin-client-secret",
  oneLoginIssuer,
  ...overrides,
});

const providerIds = (configs: ReturnType<typeof buildGenericOAuthConfigs>) =>
  configs.map((c) => (c as { providerId?: string }).providerId);

const configFor = (
  configs: ReturnType<typeof buildGenericOAuthConfigs>,
  providerId: string,
) =>
  configs.find((c) => (c as { providerId?: string }).providerId === providerId) as
    | {
        clientId?: string;
        clientSecret?: string;
        discoveryUrl?: string;
        scopes?: string[];
        pkce?: boolean;
        redirectURI?: string;
        mapProfileToUser?: (p: Record<string, any>) => { name?: string };
      }
    | undefined;

describe("buildGenericOAuthConfigs", () => {
  describe("when provider is cognito", () => {
    /** @scenario Cognito mode */
    it("mounts a cognito provider that discovers its endpoints from the issuer", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "cognito" }));

      expect(providerIds(configs)).toContain("cognito");
      const cognito = configFor(configs, "cognito");
      expect(cognito?.clientId).toBe("cognito-client-id");
      expect(cognito?.clientSecret).toBe("cognito-client-secret");
      expect(cognito?.discoveryUrl).toBe(
        `${cognitoIssuer}/.well-known/openid-configuration`,
      );
    });

    /** @scenario Only the named provider is mounted */
    it("mounts nothing else, even though every other credential is present", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "cognito" }));

      expect(providerIds(configs)).toEqual(["cognito"]);
    });

    it("asks for the scopes needed to identify the user", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "cognito" }));

      expect(configFor(configs, "cognito")?.scopes).toEqual([
        "openid",
        "email",
        "profile",
      ]);
    });

    it("uses PKCE", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "cognito" }));

      expect(configFor(configs, "cognito")?.pkce).toBe(true);
    });
  });

  describe("when provider is onelogin", () => {
    /** @scenario OneLogin mode */
    it("mounts a onelogin provider that discovers its endpoints from the issuer", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "onelogin" }));

      expect(providerIds(configs)).toContain("onelogin");
      const onelogin = configFor(configs, "onelogin");
      expect(onelogin?.clientId).toBe("onelogin-client-id");
      expect(onelogin?.clientSecret).toBe("onelogin-client-secret");
      expect(onelogin?.discoveryUrl).toBe(
        `${oneLoginIssuer}/.well-known/openid-configuration`,
      );
    });

    /** @scenario Only the named provider is mounted */
    it("mounts nothing else, even though every other credential is present", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "onelogin" }));

      expect(providerIds(configs)).toEqual(["onelogin"]);
    });
  });

  describe("when provider is oidc", () => {
    /** @scenario Any other OpenID Connect provider */
    it("mounts a provider for an identity provider we never named", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          provider: "oidc",
          oidcClientId: "oidc-client-id",
          oidcClientSecret: "oidc-client-secret",
          oidcIssuer: "https://idp.acme.test",
        }),
      );

      expect(providerIds(configs)).toEqual(["oidc"]);
      expect(configFor(configs, "oidc")?.discoveryUrl).toBe(
        "https://idp.acme.test/.well-known/openid-configuration",
      );
      expect(configFor(configs, "oidc")?.redirectURI).toBe(
        `${BASE_URL}/api/auth/callback/oidc`,
      );
    });
  });

  describe("when a credential is missing", () => {
    /** @scenario A provider missing its credentials falls back to email mode */
    it("mounts nothing for cognito without a client secret", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          provider: "cognito",
          cognitoClientSecret: undefined,
        }),
      );

      expect(configs).toEqual([]);
    });

    /** @scenario A provider missing its credentials falls back to email mode */
    it("mounts nothing for onelogin without a client secret", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          provider: "onelogin",
          oneLoginClientSecret: undefined,
        }),
      );

      expect(configs).toEqual([]);
    });

    it("mounts nothing for cognito without an issuer", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ provider: "cognito", cognitoIssuer: undefined }),
      );

      expect(configs).toEqual([]);
    });
  });

  describe("when the operator registers the callback URL", () => {
    /** @scenario The callback URL follows the same rule as every other provider */
    it("uses the same /api/auth/callback/<provider> shape the docs give for every provider", () => {
      for (const provider of PLAIN_OIDC_PROVIDER_IDS) {
        const configs = buildGenericOAuthConfigs(
          envWith({
            provider: provider,
            oidcClientId: "oidc-client-id",
            oidcClientSecret: "oidc-client-secret",
            oidcIssuer: "https://idp.acme.test",
          }),
        );

        expect(configFor(configs, provider)?.redirectURI).toBe(
          `${BASE_URL}/api/auth/callback/${provider}`,
        );
      }
    });

    /**
     * The redirect URL is compared by exact string at the identity provider,
     * so `https://host//api/auth/callback/cognito` is a different URL from the
     * one the operator registered and gets refused. baseUrl is written by
     * hand, in a values file or an env var, which is exactly where a trailing
     * slash comes from.
     */
    /** @scenario A trailing slash on the deployment URL does not change the callback URL */
    it("ignores a trailing slash on the deployment URL", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          provider: "cognito",
          baseUrl: `${BASE_URL}/`,
        }),
      );

      expect(configFor(configs, "cognito")?.redirectURI).toBe(
        `${BASE_URL}/api/auth/callback/cognito`,
      );
    });
  });

  describe("when the identity provider returns a profile with no name", () => {
    /** @scenario A profile without a display name still yields a usable name */
    it("falls back through the fields providers actually populate", () => {
      const configs = buildGenericOAuthConfigs(envWith({ provider: "cognito" }));
      const map = configFor(configs, "cognito")?.mapProfileToUser;

      expect(map?.({ preferred_username: "dogfood" }).name).toBe("dogfood");
      expect(map?.({ username: "dogfood" }).name).toBe("dogfood");
      expect(map?.({ email: "sso@example.com" }).name).toBe("sso");
    });
  });
});

describe("discoveryUrlFor", () => {
  describe("given an issuer written in any of the ways an operator might write it", () => {
    /** @scenario An untidy issuer is still understood */
    it("produces the same discovery URL", () => {
      const expected = `${cognitoIssuer}/.well-known/openid-configuration`;

      expect(discoveryUrlFor(cognitoIssuer, "cognitoIssuer")).toBe(expected);
      expect(discoveryUrlFor(`${cognitoIssuer}/`, "cognitoIssuer")).toBe(expected);
      expect(
        discoveryUrlFor(
          "cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123",
          "cognitoIssuer",
        ),
      ).toBe(expected);
    });

    /** @scenario An untidy issuer is still understood */
    it("produces the same discovery URL for a OneLogin issuer", () => {
      const expected = `${oneLoginIssuer}/.well-known/openid-configuration`;

      expect(discoveryUrlFor(oneLoginIssuer, "oneLoginIssuer")).toBe(expected);
      expect(discoveryUrlFor("acme.onelogin.com/oidc/2/", "oneLoginIssuer")).toBe(
        expected,
      );
    });
  });

  describe("given an issuer that cannot be read as a URL", () => {
    /** @scenario An unusable issuer is rejected by name */
    it("names the env var and the value it rejected", () => {
      expect(() => discoveryUrlFor("not a url at all !!!", "cognitoIssuer")).toThrow(
        /Invalid cognitoIssuer.*not a url at all/,
      );
    });
  });
});

describe("fallbackName", () => {
  describe("given a Cognito profile", () => {
    it("prefers the name Cognito sends over the derived ones", () => {
      expect(fallbackName({ name: "SSO Dogfood", email: "sso@example.com" })).toBe(
        "SSO Dogfood",
      );
    });
  });
});
