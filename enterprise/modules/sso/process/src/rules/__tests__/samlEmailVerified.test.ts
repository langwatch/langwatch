// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SAML sign-ins through Auth0 count as verified only on a proved domain (ADR-096 v3).
 * Spec: specs/identity/sso-brokered-saml-address.feature
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
  type BrokeredQuestion = { subject: string; email: string };

  /** The auth0 mapper, with identity's answer stood in for by `answer` and every question kept. */
  const mapperAnswering = (answer?: (question: BrokeredQuestion) => Promise<boolean>) => {
    const asked: BrokeredQuestion[] = [];
    const configs = buildGenericOAuthConfigs(
      {
        provider: "auth0",
        baseUrl: "https://langwatch.acme.test",
        auth0ClientId: "auth0-client-id",
        auth0ClientSecret: "auth0-client-secret",
        auth0Issuer: "https://acme.eu.auth0.com",
      },
      answer
        ? {
            isBrokeredAddressProved: async (question) => {
              asked.push(question);
              return answer(question);
            },
          }
        : {},
    );
    const mapper = configs.find((config) => config.providerId === "auth0")?.mapProfileToUser;
    if (!mapper) throw new Error("auth0 composed no profile mapper");
    return { mapper, asked };
  };

  // Auth0 reports `email_verified: false` for every SAML connection (ADR-096).
  const profile = (sub?: string, email: string | null = "alice@acme.test") => ({
    ...(sub === undefined ? {} : { sub }),
    name: "Alice Smith",
    ...(email === null ? {} : { email }),
    emailVerified: false,
    picture: "https://img.acme.test/alice.png",
  });

  describe("given a SAML subject", () => {
    /** @scenario "A brokered SAML address on the pinning organization's proved domain is verified" */
    it("marks the address verified when identity says its domain is proved for that subject", async () => {
      const { mapper, asked } = mapperAnswering(async () => true);

      const mapped = await mapper(profile("samlp|AcmeConn|alice"));

      expect(mapped).toEqual({
        name: "Alice Smith",
        email: "alice@acme.test",
        image: "https://img.acme.test/alice.png",
        emailVerified: true,
      });
      expect(asked).toEqual([{ subject: "samlp|AcmeConn|alice", email: "alice@acme.test" }]);
    });

    /** @scenario "A brokered SAML address on another organization's domain is not verified" */
    it("marks the address unverified when identity says no", async () => {
      const { mapper } = mapperAnswering(async () => false);

      const mapped = await mapper(profile("samlp|AcmeConn|bob", "bob@globex.test"));

      expect(mapped.emailVerified).toBe(false);
    });

    /** @scenario "A brokered SAML subject with no address or no answer from identity is not verified" */
    it("marks the address unverified when no identity answer is composed", async () => {
      const { mapper } = mapperAnswering();

      const mapped = await mapper(profile("samlp|AcmeConn|alice"));

      expect(mapped.emailVerified).toBe(false);
    });

    /** @scenario "A brokered SAML subject with no address or no answer from identity is not verified" */
    it("marks a profile without an address unverified and asks identity nothing", async () => {
      const { mapper, asked } = mapperAnswering(async () => true);

      const mapped = await mapper(profile("samlp|AcmeConn|alice", null));

      expect(mapped.emailVerified).toBe(false);
      expect(asked).toEqual([]);
    });

    it("lets a failed identity answer stop the sign-in rather than guess", async () => {
      const { mapper } = mapperAnswering(async () => {
        throw new Error("identity unreachable");
      });

      await expect(mapper(profile("samlp|AcmeConn|alice"))).rejects.toThrow("identity unreachable");
    });
  });

  describe("given a subject from another connection type", () => {
    /** @scenario "Profiles from the broker's other connections keep their own verification claim" */
    it.each([
      ["database", "auth0|507f1f77bcf86cd799439011"],
      ["google social", "google-oauth2|103547991597142817347"],
      ["azure enterprise", "waad|AbCdEf"],
      ["forged database user_id", "auth0|samlp|x"],
    ])("leaves emailVerified absent for a %s sub and asks nothing", async (_label, sub) => {
      const { mapper, asked } = mapperAnswering(async () => true);

      const mapped = await mapper(profile(sub));

      expect("emailVerified" in mapped).toBe(false);
      expect(asked).toEqual([]);
    });

    /** @scenario "Profiles from the broker's other connections keep their own verification claim" */
    it("leaves emailVerified absent when sub is missing", async () => {
      const { mapper } = mapperAnswering(async () => true);

      const mapped = await mapper(profile());

      expect("emailVerified" in mapped).toBe(false);
    });
  });
});
