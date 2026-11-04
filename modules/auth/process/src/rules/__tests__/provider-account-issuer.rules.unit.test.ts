/**
 * @see modules/auth/specs/account-issuer.feature
 */
import { describe, expect, it } from "vitest";

import {
  getAccountIssuer,
  findIdTokenIssuers,
  providerAccountIssuer,
} from "../provider-account-issuer.rules.ts";

const idToken = (claims: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;

const TENANT_ISSUER = "https://login.microsoftonline.com/0000-tenant/v2.0";

describe("providerAccountIssuer", () => {
  /** @scenario "An account written without an issuer gets the namespace its provider's rows carry" */
  it.each([
    { provider: "credential", idTokenIssuer: undefined, issuer: "local:credential" },
    { provider: "google", idTokenIssuer: undefined, issuer: "https://accounts.google.com" },
    { provider: "microsoft", idTokenIssuer: TENANT_ISSUER, issuer: TENANT_ISSUER },
    { provider: "microsoft", idTokenIssuer: undefined, issuer: "local:oauth:microsoft" },
    { provider: "microsoft", idTokenIssuer: "local:forged", issuer: "local:oauth:microsoft" },
    { provider: "github", idTokenIssuer: undefined, issuer: "local:oauth:github" },
    { provider: "auth0", idTokenIssuer: "https://tenant.auth0.test/", issuer: "local:oauth:auth0" },
    { provider: "a b", idTokenIssuer: undefined, issuer: "local:oauth:a%20b" },
  ])("stores a $provider account under $issuer", ({ provider, idTokenIssuer, issuer }) => {
    expect(providerAccountIssuer({ connectionIssuer: undefined, provider, idTokenIssuer })).toBe(
      issuer,
    );
  });

  /** @scenario "An account written without an issuer gets the namespace its provider's rows carry" */
  it("prefers the connection's own issuer over every derivation", () => {
    expect(
      providerAccountIssuer({ connectionIssuer: "https://idp.acme.test", provider: "credential" }),
    ).toBe("https://idp.acme.test");
  });
});

describe("getAccountIssuer", () => {
  /** @scenario "An account written without an issuer gets the namespace its provider's rows carry" */
  it("keeps an issuer the row already carries", () => {
    expect(
      getAccountIssuer({
        account: { providerId: "acme-oidc", issuer: "https://idp.acme.test" },
        connectionIssuer: "https://other.test",
      }),
    ).toBe("https://idp.acme.test");
  });

  it("reads a Microsoft row's tenant from its ID token", () => {
    expect(
      getAccountIssuer({
        account: { providerId: "microsoft", idToken: idToken({ iss: TENANT_ISSUER }) },
        connectionIssuer: undefined,
      }),
    ).toBe(TENANT_ISSUER);
  });
});

describe("findIdTokenIssuers", () => {
  it("reads the iss claim of a token", () => {
    expect(findIdTokenIssuers(idToken({ iss: TENANT_ISSUER, sub: "x" }))).toEqual([TENANT_ISSUER]);
  });

  it.each([undefined, 42, "", "not-a-jwt", "h.!!!.s", idToken({ sub: "x" }), idToken({ iss: 7 })])(
    "answers nothing for %s",
    (value) => {
      expect(findIdTokenIssuers(value)).toEqual([]);
    },
  );
});
