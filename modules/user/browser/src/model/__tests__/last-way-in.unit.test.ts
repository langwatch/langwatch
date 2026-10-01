/**
 * The one-way-in warning: silent unless exactly one way in is held.
 */

import { describe, expect, it } from "vitest";

import { lastWayInWarningFor } from "../last-way-in.ts";

const GOOGLE = { provider: "auth0", providerAccountId: "google-oauth2|1" };

describe("given how many ways in an account holds", () => {
  describe("when the password is the only one", () => {
    it("says to add a passkey", () => {
      const warning = lastWayInWarningFor({ passkeys: 0, hasPassword: true, linked: [] });

      expect(warning?.id).toBe("only-password");
      expect(warning?.message).toMatch(/Add a passkey/);
    });
  });

  describe("when a single passkey is the only one", () => {
    it("says to set a password or add a second passkey", () => {
      const warning = lastWayInWarningFor({ passkeys: 1, hasPassword: false, linked: [] });

      expect(warning?.id).toBe("only-passkey");
    });
  });

  describe("when a linked account is the only one", () => {
    it("names the provider", () => {
      const warning = lastWayInWarningFor({ passkeys: 0, hasPassword: false, linked: [GOOGLE] });

      expect(warning?.id).toBe("only-linked");
      expect(warning?.message).toContain("Google");
    });
  });

  describe("when there are two ways in, or none", () => {
    it("says nothing", () => {
      expect(lastWayInWarningFor({ passkeys: 1, hasPassword: true, linked: [] })).toBeNull();
      expect(lastWayInWarningFor({ passkeys: 0, hasPassword: false, linked: [] })).toBeNull();
    });
  });
});
