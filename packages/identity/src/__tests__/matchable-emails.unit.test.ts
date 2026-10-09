import { describe, expect, it } from "vitest";
import type { IdentifierFact, IdentityHeads } from "../facts";
import { matchableEmailsOf } from "../matchable-emails";

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

describe("matchableEmailsOf", () => {
  describe("when a user holds proven identifiers across providers", () => {
    it("answers every PRIMARY and VERIFIED value, whatever method proved it", () => {
      const heads = headsOf(
        identifier({ identifierId: "idf_a", state: "PRIMARY" }),
        identifier({
          identifierId: "idf_b",
          provider: "google",
          value: "sam@home.net",
          domain: "home.net",
        }),
      );

      expect(matchableEmailsOf({ heads })).toEqual([
        { identifierId: "idf_a", value: "sam@acme.com", provider: "email" },
        { identifierId: "idf_b", value: "sam@home.net", provider: "google" },
      ]);
    });
  });

  describe("when identifiers are unproven, tombstoned, or erased", () => {
    /** @scenario "Acceptance requires verification and an exact normalized match" */
    it("answers nothing for them, so an unproven address opens no invitation", () => {
      const heads = headsOf(
        identifier({ identifierId: "idf_a", state: "ATTACHED" }),
        identifier({ identifierId: "idf_b", state: "DETACHED" }),
        identifier({ identifierId: "idf_c", state: "DEAD_END" }),
        identifier({ identifierId: "idf_d", value: null }),
      );

      expect(matchableEmailsOf({ heads })).toEqual([]);
    });
  });
});
