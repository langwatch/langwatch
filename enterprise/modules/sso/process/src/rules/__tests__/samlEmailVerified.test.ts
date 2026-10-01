// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SAML sign-ins through Auth0 count as verified emails (ADR-096).
 *
 * Auth0 reports `email_verified: false` for every SAML connection with no
 * per-connection switch to change it, and BetterAuth refuses to link an
 * OAuth sign-in with an unverified email to an existing user. The auth0
 * `mapProfileToUser` therefore returns `emailVerified: true` when — and
 * only when — the profile's `sub` carries the `samlp|` strategy prefix.
 *
 * These tests pin the security boundary from both sides: SAML subs are
 * upgraded, and every other sub shape produces a mapped profile with NO
 * `emailVerified` key at all, so the claim-derived value flows through
 * untouched.
 */
import { describe, expect, it } from "vitest";

import { buildGenericOAuthConfigs, isSamlSub } from "../sign-in-providers.rules.ts";

describe("isSamlSub", () => {
  it("matches an Auth0 SAML sub", () => {
    expect(isSamlSub("samlp|SomeConnection|user@acme.test")).toBe(true);
  });

  it("rejects other Auth0 connection strategies", () => {
    expect(isSamlSub("auth0|507f1f77bcf86cd799439011")).toBe(false);
    expect(isSamlSub("google-oauth2|103547991597142817347")).toBe(false);
    expect(isSamlSub("waad|AbCdEf")).toBe(false);
  });

  it("rejects a forged sub from a database connection", () => {
    // A database user_id of `samlp|x` still gets the strategy prefix:
    expect(isSamlSub("auth0|samlp|x")).toBe(false);
  });

  it("requires the trailing pipe, so a samlpx strategy never matches", () => {
    expect(isSamlSub("samlpx|whatever")).toBe(false);
    expect(isSamlSub("samlp")).toBe(false);
  });

  it("rejects absent and non-string subs", () => {
    expect(isSamlSub(undefined)).toBe(false);
    expect(isSamlSub(null)).toBe(false);
    expect(isSamlSub(42)).toBe(false);
    expect(isSamlSub({})).toBe(false);
  });
});

describe("auth0 mapProfileToUser emailVerified", () => {
  const mapProfileToUser = () => {
    const configs = buildGenericOAuthConfigs({
      provider: "auth0",
      baseUrl: "https://langwatch.acme.test",
      auth0ClientId: "auth0-client-id",
      auth0ClientSecret: "auth0-client-secret",
      auth0Issuer: "https://acme.eu.auth0.com",
    });
    const mapper = configs.find((config) => config.providerId === "auth0")?.mapProfileToUser;
    if (!mapper) throw new Error("auth0 composed no profile mapper");
    return mapper;
  };

  // Auth0 reports `email_verified: false` for every SAML connection (ADR-096).
  const profile = (sub?: string) => ({
    ...(sub === undefined ? {} : { sub }),
    name: "Alice Smith",
    email: "alice@acme.test",
    emailVerified: false,
    picture: "https://img.acme.test/alice.png",
  });

  /** @invariant SAML profiles map to emailVerified: true */
  it("marks a SAML profile's email as verified", async () => {
    const mapped = await mapProfileToUser()(profile("samlp|AcmeConn|alice"));
    expect(mapped.emailVerified).toBe(true);
  });

  /** @invariant Non-SAML profiles get no emailVerified key */
  it.each([
    ["database", "auth0|507f1f77bcf86cd799439011"],
    ["google social", "google-oauth2|103547991597142817347"],
    ["azure enterprise", "waad|AbCdEf"],
    ["forged database user_id", "auth0|samlp|x"],
  ])("leaves emailVerified absent for a %s sub", async (_label, sub) => {
    const mapped = await mapProfileToUser()(profile(sub));
    expect("emailVerified" in mapped).toBe(false);
  });

  it("leaves emailVerified absent when sub is missing", async () => {
    const mapped = await mapProfileToUser()(profile());
    expect("emailVerified" in mapped).toBe(false);
  });

  /** @invariant Rest of the mapping unchanged */
  it("keeps name, email and image mapping identical for SAML profiles", async () => {
    const mapped = await mapProfileToUser()(profile("samlp|AcmeConn|alice"));
    expect(mapped).toEqual({
      name: "Alice Smith",
      email: "alice@acme.test",
      image: "https://img.acme.test/alice.png",
      emailVerified: true,
    });
  });
});
