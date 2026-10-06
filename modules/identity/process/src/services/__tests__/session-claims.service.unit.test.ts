/**
 * What a minted session records (D06), ported from main's session-claims tests.
 * specs/identity/saml-existing-user-linking.feature (bound live in apps/api, not here).
 */
import type { IdentifierFact, IdentityHeads } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { CryptoIdentifierIdentityService } from "../crypto-identifier-identity.service.ts";
import { SessionClaimsService } from "../session-claims.service.ts";

const USER = "user_1";
const SAML = "acme-saml";
const ACS = `/sso/saml2/sp/acs/${SAML}`;
const identifiers = CryptoIdentifierIdentityService.create();

function head(overrides: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "idf_live",
    userId: USER,
    provider: "saml",
    value: "ada@acme.test",
    domain: "acme.test",
    identifierHash: null,
    accountId: "acct_row_1",
    providerId: SAML,
    issuer: "https://idp.acme.test",
    providerAccountId: "ada-subject",
    connectionId: "conn_1",
    state: "VERIFIED",
    verifiedAtMs: 1,
    attachedAtMs: 1_000,
    detachedAtMs: null,
    ...overrides,
  };
}

function serviceOver(rows: IdentifierFact[]): SessionClaimsService {
  const heads: IdentityHeads = {
    userId: USER,
    identifiers: Object.fromEntries(rows.map((row) => [row.identifierId, row])),
  };
  return SessionClaimsService.create({ heads: { findHeads: async () => heads }, identifiers });
}

const evidence = {
  providerAccountId: "ada-subject",
  assertedFactors: [],
  verifiedTokenClaims: false,
};
const account = { accountId: "acct_row_1", createdAtMs: 1_700_000_000_000, email: "Ada@Acme.test" };

describe("SessionClaimsService.claimsForMint", () => {
  describe("when a federated callback carries this request's account evidence", () => {
    it("records the exact live identifier, newest first, and no unproved factor", async () => {
      const claims = await serviceOver([
        head({ identifierId: "idf_old", attachedAtMs: 1_000 }),
        head({ identifierId: "idf_new", attachedAtMs: 2_000 }),
        head({ identifierId: "idf_other", providerAccountId: "someone-else", attachedAtMs: 3_000 }),
      ]).claimsForMint({ userId: USER, path: ACS, callback: evidence });

      expect(claims).toEqual({ identifierId: "idf_new", amr: [] });
    });

    it("derives the id the backfill will project when the account is not projected yet", async () => {
      const claims = await serviceOver([]).claimsForMint({
        userId: USER,
        path: ACS,
        callback: { ...evidence, account },
      });

      expect(claims.identifierId).toBe(
        identifiers.deriveIdentifierId({
          userId: USER,
          provider: "oidc",
          providerAccountId: "ada-subject",
          normalizedValue: "ada@acme.test",
          occurredAtMs: account.createdAtMs,
        }),
      );
    });
  });

  describe("when the evidence is uncertain", () => {
    it("records nothing for a callback path with no evidence in this request", async () => {
      const claims = await serviceOver([head({})]).claimsForMint({ userId: USER, path: ACS });

      expect(claims).toEqual({ identifierId: null, amr: [] });
    });

    it("does not revive a detached identifier nor borrow one holding the same account", async () => {
      const detached = head({ state: "DETACHED", detachedAtMs: 5_000 });
      const claims = await serviceOver([detached]).claimsForMint({
        userId: USER,
        path: ACS,
        callback: { ...evidence, account },
      });

      expect(claims.identifierId).toBeNull();
    });

    it("refuses to derive without the one native account read in the callback's transaction", async () => {
      const claims = await serviceOver([]).claimsForMint({
        userId: USER,
        path: ACS,
        callback: evidence,
      });

      expect(claims.identifierId).toBeNull();
    });

    it("records nothing for a path it does not recognize", async () => {
      const claims = await serviceOver([head({})]).claimsForMint({
        userId: USER,
        path: "/update-user",
        callback: { ...evidence, account },
      });

      expect(claims).toEqual({ identifierId: null, amr: [] });
    });
  });

  describe("when a password sign-in mints the session", () => {
    it("records the live credential identifier and the password it proved", async () => {
      const credential = head({
        identifierId: "idf_pwd",
        provider: "credential",
        providerId: "credential",
        providerAccountId: USER,
      });
      const claims = await serviceOver([credential]).claimsForMint({
        userId: USER,
        path: "/sign-in/email",
      });

      expect(claims).toEqual({ identifierId: "idf_pwd", amr: ["pwd"] });
    });
  });

  describe("when a verified token asserted factors for the exact account", () => {
    it("credits the asserted factors on top of the protocol", async () => {
      const claims = await serviceOver([head({})]).claimsForMint({
        userId: USER,
        path: `/oauth2/callback/${SAML}`,
        callback: { ...evidence, assertedFactors: ["mfa", "otp"], verifiedTokenClaims: true },
      });

      expect(claims.amr).toEqual(["oidc", "mfa", "otp"]);
    });
  });
});
