/**
 * The credential account lookup better-auth issues, with and without the issuer clause 1.7.3
 * dropped (ADR-189).
 * Spec: specs/identity/identity-storage-adapter.feature
 */
import { describe, expect, it } from "vitest";

import { parseAccountQuery } from "../better-auth-account-queries.rules.ts";

const clause = (field: string, value: string) => ({ field, value, operator: "eq" });
const EXPECTED = {
  kind: "byUserProviderSubject",
  userId: "user_1",
  providerId: "credential",
  accountId: "user_1",
};

describe("parseAccountQuery", () => {
  describe("when the credential lookup names a user, provider and subject", () => {
    /** @scenario "The credential account lookup is served with or without an issuer clause" */
    it("serves it as the user's provider subject lookup", () => {
      const where = [
        clause("userId", "user_1"),
        clause("providerId", "credential"),
        clause("accountId", "user_1"),
      ];

      expect(parseAccountQuery({ operation: "findOne", where })).toEqual(EXPECTED);
    });

    /** @scenario "The credential account lookup is served with or without an issuer clause" */
    it("serves the older form that also names an issuer the same way", () => {
      const where = [
        clause("userId", "user_1"),
        clause("providerId", "credential"),
        clause("issuer", "local:credential"),
        clause("accountId", "user_1"),
      ];

      expect(parseAccountQuery({ operation: "findOne", where })).toEqual(EXPECTED);
    });
  });
});
