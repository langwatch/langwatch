// @vitest-environment node
// ADR-094 Decision 9 / Constants "Erased-email token". The property that
// matters is not secrecy but REPRODUCIBILITY: the report re-derives the token
// from ClickHouse's raw emails at read time, so an erased person keeps
// matching their own timeline instead of dropping into "unattributed".
import { describe, expect, it } from "vitest";

import {
  ERASED_EMAIL_TOKEN_PREFIX,
  IdentityErasureTokenService,
  isErasedEmailToken,
} from "../erasure-token.service";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const service = (secret = SECRET) => new IdentityErasureTokenService(secret);

describe("IdentityErasureTokenService", () => {
  describe("given the same email and organization", () => {
    it("derives the same token every time, in any casing or padding", () => {
      // This IS the stored-token-equals-report-derived-token test the ADR
      // Constants table names: erasure stores the left-hand value, the report
      // derives the right-hand one from a raw ledger row, and they must be
      // equal or the erased timeline stops matching.
      const stored = service().tokenFor({
        organizationId: "org-a",
        email: "Alice@Example.com",
      });
      const reportDerived = service().tokenFor({
        organizationId: "org-a",
        email: "  alice@example.com ",
      });
      expect(reportDerived).toBe(stored);
    });

    it("survives a fresh instance — nothing is held in memory between runs", () => {
      const first = service().tokenFor({
        organizationId: "org-a",
        email: "alice@example.com",
      });
      const second = service().tokenFor({
        organizationId: "org-a",
        email: "alice@example.com",
      });
      expect(second).toBe(first);
    });
  });

  describe("given a different organization", () => {
    // Per-organization keys: one organization's oracle must not be every
    // organization's oracle.
    it("derives a different token for the same address", () => {
      const inA = service().tokenFor({
        organizationId: "org-a",
        email: "alice@example.com",
      });
      const inB = service().tokenFor({
        organizationId: "org-b",
        email: "alice@example.com",
      });
      expect(inB).not.toBe(inA);
    });
  });

  describe("given a different master secret", () => {
    it("derives a different token", () => {
      expect(
        service(OTHER_SECRET).tokenFor({
          organizationId: "org-a",
          email: "alice@example.com",
        }),
      ).not.toBe(
        service().tokenFor({
          organizationId: "org-a",
          email: "alice@example.com",
        }),
      );
    });
  });

  describe("the token's shape", () => {
    it("is recognisable and can never be read as an address", () => {
      const token = service().tokenFor({
        organizationId: "org-a",
        email: "alice@example.com",
      });
      expect(token.startsWith(ERASED_EMAIL_TOKEN_PREFIX)).toBe(true);
      expect(token).not.toContain("@");
      expect(isErasedEmailToken(token)).toBe(true);
      expect(isErasedEmailToken("alice@example.com")).toBe(false);
    });

    it("is a 64-character hex digest behind the prefix", () => {
      const token = service().tokenFor({
        organizationId: "org-a",
        email: "alice@example.com",
      });
      expect(token.slice(ERASED_EMAIL_TOKEN_PREFIX.length)).toMatch(
        /^[0-9a-f]{64}$/,
      );
    });
  });

  describe("tokensFor", () => {
    it("keys by the RAW input so a stored externalId maps straight to its replacement", () => {
      const tokens = service().tokensFor({
        organizationId: "org-a",
        emails: ["Alice@Example.com", "bob@example.com"],
      });
      expect([...tokens.keys()]).toEqual([
        "Alice@Example.com",
        "bob@example.com",
      ]);
      expect(tokens.get("Alice@Example.com")).toBe(
        service().tokenFor({
          organizationId: "org-a",
          email: "alice@example.com",
        }),
      );
    });

    describe("when a value is already a token", () => {
      // Erasing the same person twice must not hash the first pass's token
      // into a second one the report could never re-derive.
      it("skips it rather than hashing a hash", () => {
        const alreadyToken = service().tokenFor({
          organizationId: "org-a",
          email: "alice@example.com",
        });
        const tokens = service().tokensFor({
          organizationId: "org-a",
          emails: [alreadyToken, ""],
        });
        expect(tokens.size).toBe(0);
      });
    });
  });

  describe("given no master secret", () => {
    it("refuses to construct rather than blanking emails behind an unreproducible token", () => {
      expect(() => new IdentityErasureTokenService("")).toThrow(
        /LW_IDENTITY_ERASURE_SECRET/,
      );
    });
  });
});
