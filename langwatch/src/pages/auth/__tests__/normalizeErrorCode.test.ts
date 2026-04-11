import { describe, expect, it } from "vitest";
import { normalizeErrorCode } from "../error";

describe("normalizeErrorCode", () => {
  describe("when given null or undefined", () => {
    it("returns null", () => {
      expect(normalizeErrorCode(null)).toBeNull();
      expect(normalizeErrorCode(undefined)).toBeNull();
    });
  });

  describe("when given a BetterAuth different-email error", () => {
    it("maps email_doesn't_match to DIFFERENT_EMAIL_NOT_ALLOWED", () => {
      expect(normalizeErrorCode("email_doesn't_match")).toBe(
        "DIFFERENT_EMAIL_NOT_ALLOWED",
      );
    });

    it("maps LINKING_DIFFERENT_EMAILS_NOT_ALLOWED to DIFFERENT_EMAIL_NOT_ALLOWED", () => {
      expect(normalizeErrorCode("LINKING_DIFFERENT_EMAILS_NOT_ALLOWED")).toBe(
        "DIFFERENT_EMAIL_NOT_ALLOWED",
      );
    });
  });

  describe("when given a BetterAuth account-already-linked error", () => {
    it("maps account_already_linked_to_different_user to OAuthAccountNotLinked", () => {
      expect(
        normalizeErrorCode("account_already_linked_to_different_user"),
      ).toBe("OAuthAccountNotLinked");
    });
  });

  describe("when given a NextAuth-era code that's already correct", () => {
    it("passes SSO_PROVIDER_NOT_ALLOWED through unchanged", () => {
      expect(normalizeErrorCode("SSO_PROVIDER_NOT_ALLOWED")).toBe(
        "SSO_PROVIDER_NOT_ALLOWED",
      );
    });

    it("passes DIFFERENT_EMAIL_NOT_ALLOWED through unchanged", () => {
      expect(normalizeErrorCode("DIFFERENT_EMAIL_NOT_ALLOWED")).toBe(
        "DIFFERENT_EMAIL_NOT_ALLOWED",
      );
    });

    it("passes OAuthAccountNotLinked through unchanged", () => {
      expect(normalizeErrorCode("OAuthAccountNotLinked")).toBe(
        "OAuthAccountNotLinked",
      );
    });
  });

  describe("when given an unknown error code", () => {
    it("passes it through unchanged", () => {
      expect(normalizeErrorCode("some_other_error")).toBe("some_other_error");
    });
  });
});
