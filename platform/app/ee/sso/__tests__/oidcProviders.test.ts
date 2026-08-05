// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cognito and OneLogin are configured from a client id, a client secret and an
 * issuer, with every endpoint read from the issuer's OIDC discovery document.
 * These tests pin that contract: which provider mounts for a given
 * NEXTAUTH_PROVIDER, what discovery URL the issuer turns into, and the callback
 * URL an operator has to register with their identity provider.
 *
 * Covers specs/auth/sso-oidc-providers.feature.
 */
import { describe, expect, it } from "vitest";
import {
  buildGenericOAuthConfigs,
  discoveryUrlFor,
  fallbackName,
} from "../providers";

const BASE_URL = "https://langwatch.acme.test";

const COGNITO_ISSUER =
  "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123";
const ONELOGIN_ISSUER = "https://acme.onelogin.com/oidc/2";

/**
 * A deployment env with both providers' credentials present. Individual tests
 * flip `NEXTAUTH_PROVIDER` or drop a credential. The point of most of these is
 * that having credentials lying around is not what decides which provider
 * mounts.
 */
const envWith = (overrides: Record<string, string | undefined>) => ({
  NEXTAUTH_PROVIDER: "email",
  NEXTAUTH_URL: BASE_URL,
  COGNITO_CLIENT_ID: "cognito-client-id",
  COGNITO_CLIENT_SECRET: "cognito-client-secret",
  COGNITO_ISSUER,
  ONELOGIN_CLIENT_ID: "onelogin-client-id",
  ONELOGIN_CLIENT_SECRET: "onelogin-client-secret",
  ONELOGIN_ISSUER,
  ...overrides,
});

const providerIds = (configs: ReturnType<typeof buildGenericOAuthConfigs>) =>
  configs.map((c) => (c as { providerId?: string }).providerId);

const configFor = (
  configs: ReturnType<typeof buildGenericOAuthConfigs>,
  providerId: string,
) =>
  configs.find(
    (c) => (c as { providerId?: string }).providerId === providerId,
  ) as
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
  describe("when NEXTAUTH_PROVIDER is cognito", () => {
    /** @scenario Cognito mode */
    it("mounts a cognito provider that discovers its endpoints from the issuer", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito" }),
      );

      expect(providerIds(configs)).toContain("cognito");
      const cognito = configFor(configs, "cognito");
      expect(cognito?.clientId).toBe("cognito-client-id");
      expect(cognito?.clientSecret).toBe("cognito-client-secret");
      expect(cognito?.discoveryUrl).toBe(
        `${COGNITO_ISSUER}/.well-known/openid-configuration`,
      );
    });

    /** @scenario Only the named provider is mounted */
    it("mounts nothing else, even though every other credential is present", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito" }),
      );

      expect(providerIds(configs)).toEqual(["cognito"]);
    });

    it("asks for the scopes needed to identify the user", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito" }),
      );

      expect(configFor(configs, "cognito")?.scopes).toEqual([
        "openid",
        "email",
        "profile",
      ]);
    });

    it("uses PKCE", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito" }),
      );

      expect(configFor(configs, "cognito")?.pkce).toBe(true);
    });
  });

  describe("when NEXTAUTH_PROVIDER is onelogin", () => {
    /** @scenario OneLogin mode */
    it("mounts a onelogin provider that discovers its endpoints from the issuer", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "onelogin" }),
      );

      expect(providerIds(configs)).toContain("onelogin");
      const onelogin = configFor(configs, "onelogin");
      expect(onelogin?.clientId).toBe("onelogin-client-id");
      expect(onelogin?.clientSecret).toBe("onelogin-client-secret");
      expect(onelogin?.discoveryUrl).toBe(
        `${ONELOGIN_ISSUER}/.well-known/openid-configuration`,
      );
    });

    /** @scenario Only the named provider is mounted */
    it("mounts nothing else, even though every other credential is present", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "onelogin" }),
      );

      expect(providerIds(configs)).toEqual(["onelogin"]);
    });
  });

  describe("when NEXTAUTH_PROVIDER is oidc", () => {
    /** @scenario Any other OpenID Connect provider */
    it("mounts a provider for an identity provider we never named", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          NEXTAUTH_PROVIDER: "oidc",
          OIDC_CLIENT_ID: "oidc-client-id",
          OIDC_CLIENT_SECRET: "oidc-client-secret",
          OIDC_ISSUER: "https://idp.acme.test",
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
          NEXTAUTH_PROVIDER: "cognito",
          COGNITO_CLIENT_SECRET: undefined,
        }),
      );

      expect(configs).toEqual([]);
    });

    /** @scenario A provider missing its credentials falls back to email mode */
    it("mounts nothing for onelogin without a client secret", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          NEXTAUTH_PROVIDER: "onelogin",
          ONELOGIN_CLIENT_SECRET: undefined,
        }),
      );

      expect(configs).toEqual([]);
    });

    it("mounts nothing for cognito without an issuer", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito", COGNITO_ISSUER: undefined }),
      );

      expect(configs).toEqual([]);
    });
  });

  describe("when the operator registers the callback URL", () => {
    /** @scenario The callback URL follows the same rule as every other provider */
    it("uses the same /api/auth/callback/<provider> shape the docs give for every provider", () => {
      for (const provider of ["cognito", "onelogin", "oidc"]) {
        const configs = buildGenericOAuthConfigs(
          envWith({
            NEXTAUTH_PROVIDER: provider,
            OIDC_CLIENT_ID: "oidc-client-id",
            OIDC_CLIENT_SECRET: "oidc-client-secret",
            OIDC_ISSUER: "https://idp.acme.test",
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
     * one the operator registered and gets refused. NEXTAUTH_URL is written by
     * hand, in a values file or an env var, which is exactly where a trailing
     * slash comes from.
     */
    /** @scenario A trailing slash on the deployment URL does not change the callback URL */
    it("ignores a trailing slash on the deployment URL", () => {
      const configs = buildGenericOAuthConfigs(
        envWith({
          NEXTAUTH_PROVIDER: "cognito",
          NEXTAUTH_URL: `${BASE_URL}/`,
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
      const configs = buildGenericOAuthConfigs(
        envWith({ NEXTAUTH_PROVIDER: "cognito" }),
      );
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
      const expected = `${COGNITO_ISSUER}/.well-known/openid-configuration`;

      expect(discoveryUrlFor(COGNITO_ISSUER, "COGNITO_ISSUER")).toBe(expected);
      expect(discoveryUrlFor(`${COGNITO_ISSUER}/`, "COGNITO_ISSUER")).toBe(
        expected,
      );
      expect(
        discoveryUrlFor(
          "cognito-idp.eu-central-1.amazonaws.com/eu-central-1_abc123",
          "COGNITO_ISSUER",
        ),
      ).toBe(expected);
    });

    /** @scenario An untidy issuer is still understood */
    it("produces the same discovery URL for a OneLogin issuer", () => {
      const expected = `${ONELOGIN_ISSUER}/.well-known/openid-configuration`;

      expect(discoveryUrlFor(ONELOGIN_ISSUER, "ONELOGIN_ISSUER")).toBe(
        expected,
      );
      expect(
        discoveryUrlFor("acme.onelogin.com/oidc/2/", "ONELOGIN_ISSUER"),
      ).toBe(expected);
    });
  });

  describe("given an issuer that cannot be read as a URL", () => {
    /** @scenario An unusable issuer is rejected by name */
    it("names the env var and the value it rejected", () => {
      expect(() =>
        discoveryUrlFor("not a url at all !!!", "COGNITO_ISSUER"),
      ).toThrow(/Invalid COGNITO_ISSUER.*not a url at all/);
    });
  });
});

describe("fallbackName", () => {
  describe("given a Cognito profile", () => {
    it("prefers the name Cognito sends over the derived ones", () => {
      expect(
        fallbackName({ name: "SSO Dogfood", email: "sso@example.com" }),
      ).toBe("SSO Dogfood");
    });
  });
});
