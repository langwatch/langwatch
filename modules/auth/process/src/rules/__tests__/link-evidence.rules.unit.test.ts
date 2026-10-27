/**
 * When a sign-in method added to an existing account needs evidence (ADR-117 §3).
 */
import { describe, expect, it } from "vitest";

import { linkVerdictFor } from "../link-evidence.rules.ts";

const UNVERIFIED_BY_PROVIDER = {
  asserted: true,
  email: "sam@acme.test",
  emailVerified: false,
} as const;

describe("linkVerdictFor", () => {
  describe("given a person with no sign-in method yet", () => {
    it("lets the first method through", () => {
      expect(
        linkVerdictFor({
          address: UNVERIFIED_BY_PROVIDER,
          holdsVerifiedEmail: true,
          attachedAccounts: 0,
          attachedPasskeys: 0,
        }),
      ).toEqual({ refused: false });
    });
  });

  describe("given an account that signs in with a passkey only", () => {
    it("judges the addition as it would for any account that already signs in", () => {
      expect(
        linkVerdictFor({
          address: UNVERIFIED_BY_PROVIDER,
          holdsVerifiedEmail: true,
          attachedAccounts: 0,
          attachedPasskeys: 1,
        }),
      ).toEqual({ refused: true, reason: "unverified_orphan" });
    });
  });

  describe("given an account with a linked provider", () => {
    it("allows the addition when both sides verified the address", () => {
      expect(
        linkVerdictFor({
          address: { ...UNVERIFIED_BY_PROVIDER, emailVerified: true },
          holdsVerifiedEmail: true,
          attachedAccounts: 1,
          attachedPasskeys: 0,
        }),
      ).toEqual({ refused: false });
    });
  });
});
