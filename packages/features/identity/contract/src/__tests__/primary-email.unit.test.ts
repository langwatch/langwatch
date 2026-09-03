import { describe, expect, it } from "vitest";
import type { IdentifierFact, IdentityHeads } from "../facts";
import { primaryEmailOf } from "../primary-email";

const USER = "user_sam";
const T0 = 1_690_000_000_000;

function identifier(overrides: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_a",
    userId: USER,
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: "hmac:a",
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: T0,
    attachedAtMs: T0,
    detachedAtMs: null,
    ...overrides,
  };
}

function headsOf(...facts: IdentifierFact[]): IdentityHeads {
  return {
    userId: USER,
    identifiers: Object.fromEntries(facts.map((f) => [f.identifierId, f])),
  };
}

describe("primaryEmailOf", () => {
  describe("given the user has a PRIMARY identifier", () => {
    /** @scenario "The legacy email field answers from the identifiers" */
    it("answers the primary, whatever else is verified", () => {
      const heads = headsOf(
        identifier({
          identifierId: "idf_new",
          value: "newer@acme.com",
          state: "VERIFIED",
          verifiedAtMs: T0 + 5_000,
        }),
        identifier({
          identifierId: "idf_chosen",
          value: "chosen@acme.com",
          state: "PRIMARY",
          verifiedAtMs: T0,
        }),
      );

      expect(primaryEmailOf({ heads })).toBe("chosen@acme.com");
    });
  });

  describe("given the user has no PRIMARY but several VERIFIED", () => {
    it("answers the most recently verified", () => {
      const heads = headsOf(
        identifier({
          identifierId: "idf_old",
          value: "old@acme.com",
          verifiedAtMs: T0,
        }),
        identifier({
          identifierId: "idf_new",
          value: "new@acme.com",
          verifiedAtMs: T0 + 5_000,
        }),
      );

      expect(primaryEmailOf({ heads })).toBe("new@acme.com");
    });

    it("breaks a tie on identifier id, so every pod answers the same", () => {
      const heads = headsOf(
        identifier({ identifierId: "idf_b", value: "b@acme.com" }),
        identifier({ identifierId: "idf_a", value: "a@acme.com" }),
      );

      expect(primaryEmailOf({ heads })).toBe("a@acme.com");
    });
  });

  describe("given only unproven or dead identifiers", () => {
    /** @scenario "An unproven address never answers the legacy email field" */
    it("answers nothing for ATTACHED, DETACHED or DEAD_END", () => {
      for (const state of ["ATTACHED", "DETACHED", "DEAD_END"] as const) {
        const heads = headsOf(identifier({ state }));
        expect(primaryEmailOf({ heads })).toBeNull();
      }
    });
  });

  describe("given the user was erased", () => {
    it("answers nothing: erasure wiped the value off the tombstone", () => {
      const heads = headsOf(identifier({ value: null, state: "PRIMARY" }));

      expect(primaryEmailOf({ heads })).toBeNull();
    });
  });

  describe("given a verified non-email identifier", () => {
    it("ignores it: the legacy column holds an email, not a subject", () => {
      const heads = headsOf(identifier({ identifierId: "idf_sso", provider: "saml" }));

      expect(primaryEmailOf({ heads })).toBeNull();
    });
  });

  describe("given the user holds no identifiers at all", () => {
    it("answers nothing, so the caller keeps the legacy column", () => {
      expect(primaryEmailOf({ heads: headsOf() })).toBeNull();
    });
  });
});
