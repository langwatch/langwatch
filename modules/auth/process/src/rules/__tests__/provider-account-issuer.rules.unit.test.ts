/**
 * The issuer namespace a new account row is stamped with (ADR-189).
 * Spec: specs/identity/account-issuer-namespace.feature
 */
import { describe, expect, it } from "vitest";

import { accountIssuerOf } from "../provider-account-issuer.rules.ts";

const idTokenWith = (claims: Record<string, unknown>): string =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

const DISCOVERED_ISSUER = "https://tenant.eu.auth0.com/";
const TENANT_ISSUER = "https://login.microsoftonline.com/7d1c-tenant/v2.0";

describe("accountIssuerOf", () => {
  describe("when the row carries nothing but its provider", () => {
    /** @scenario A new account row carries the issuer namespace its provider's stored rows carry */
    it.each([
      ["credential", "local:credential"],
      ["google", "https://accounts.google.com"],
      ["github", "local:oauth:github"],
      ["gitlab", "local:oauth:gitlab"],
      ["auth0", "local:oauth:auth0"],
      ["okta", "local:oauth:okta"],
      ["oidc", "local:oauth:oidc"],
    ])("stamps a %s row with %s", (providerId, expected) => {
      const issuer = accountIssuerOf({
        statedIssuer: undefined,
        assertedIssuers: [],
        providerId,
        idToken: idTokenWith({ iss: DISCOVERED_ISSUER, sub: "sam" }),
      });

      expect(issuer).toBe(expected);
    });
  });

  describe("when the row is a Microsoft account", () => {
    /** @scenario A Microsoft account row carries its tenant's issuer */
    it("stamps the tenant issuer its ID token states", () => {
      const issuer = accountIssuerOf({
        statedIssuer: undefined,
        assertedIssuers: [],
        providerId: "microsoft",
        idToken: idTokenWith({ iss: TENANT_ISSUER, sub: "sam" }),
      });

      expect(issuer).toBe(TENANT_ISSUER);
    });

    /** @scenario A Microsoft account row carries its tenant's issuer */
    it.each([
      ["no ID token", undefined],
      ["an unreadable ID token", "not-a-token"],
      ["an ID token with no issuer", idTokenWith({ sub: "sam" })],
    ])("falls back to the stored namespace for %s", (_name, idToken) => {
      expect(
        accountIssuerOf({
          statedIssuer: undefined,
          assertedIssuers: [],
          providerId: "microsoft",
          idToken,
        }),
      ).toBe("local:oauth:microsoft");
    });
  });

  describe("when a single sign-on assertion was verified for this subject", () => {
    /** @scenario A single sign-on account row carries the issuer its assertion was verified under */
    it("stamps the issuer it was verified under", () => {
      const issuer = accountIssuerOf({
        statedIssuer: undefined,
        assertedIssuers: ["https://idp.acme.test"],
        providerId: "conn_acme",
        idToken: undefined,
      });

      expect(issuer).toBe("https://idp.acme.test");
    });
  });

  describe("when the row already states an issuer", () => {
    it("keeps it, as a confirmed link proposal writes it", () => {
      const issuer = accountIssuerOf({
        statedIssuer: "https://idp.acme.test",
        assertedIssuers: [],
        providerId: "conn_acme",
        idToken: undefined,
      });

      expect(issuer).toBe("https://idp.acme.test");
    });
  });
});
