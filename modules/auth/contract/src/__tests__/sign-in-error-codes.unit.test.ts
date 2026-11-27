/** @see specs/identity/sso-signin-error-boundary.feature */
import { describe, expect, it } from "vitest";

import {
  CUTOVER_SIGN_IN_ERROR_CODES,
  isStableAuthError,
  normalizeSignInErrorCode,
  signInErrorMayCross,
  STABLE_AUTH_ERRORS,
} from "../sign-in-error-codes.ts";

describe("normalizeSignInErrorCode", () => {
  describe("when the callback redirects without an error code", () => {
    /** @scenario "A sign-in that succeeds is not read as a failure" */
    it("reads no code, so a successful sign-in is never classified", () => {
      expect(normalizeSignInErrorCode(null)).toBeNull();
      expect(normalizeSignInErrorCode(undefined)).toBeNull();
      expect(normalizeSignInErrorCode("")).toBeNull();
      expect(signInErrorMayCross(null)).toBe(false);
    });
  });

  describe("when the library refuses a link because the emails differ", () => {
    /** @scenario "The different-email refusal shows the specific message" */
    it("maps email_does_not_match to DIFFERENT_EMAIL_NOT_ALLOWED", () => {
      expect(normalizeSignInErrorCode("email_does_not_match")).toBe("DIFFERENT_EMAIL_NOT_ALLOWED");
    });
  });

  describe("when the library refuses a sign-in for an account under another method", () => {
    /** @scenario "The native account-link refusal maps to a stable sign-in error" */
    it("maps account_not_linked to OAuthAccountNotLinked, which is stable and may cross", () => {
      const code = normalizeSignInErrorCode("account_not_linked");
      expect(code).toBe("OAuthAccountNotLinked");
      expect(isStableAuthError(code)).toBe(true);
      expect(signInErrorMayCross("account_not_linked")).toBe(true);
    });
  });

  describe("when the provider account being linked already belongs to another user", () => {
    /** @scenario "A provider account already linked to another user crosses with its own code" */
    it("maps it to its own screen code, which is stable and may cross", () => {
      const code = normalizeSignInErrorCode("account_already_linked_to_different_user");
      expect(code).toBe("ACCOUNT_LINKED_TO_ANOTHER_USER");
      expect(isStableAuthError(code)).toBe(true);
      expect(signInErrorMayCross("account_already_linked_to_different_user")).toBe(true);
    });
  });

  describe("when the code is already a screen code", () => {
    it.each([
      "SSO_PROVIDER_NOT_ALLOWED",
      "DIFFERENT_EMAIL_NOT_ALLOWED",
      "OAuthAccountNotLinked",
      "ACCOUNT_LINKED_TO_ANOTHER_USER",
    ])("returns %s as itself", (code) => {
      expect(normalizeSignInErrorCode(code)).toBe(code);
    });
  });

  describe("when an address carries the earlier library release's spelling", () => {
    /** @scenario "The earlier library's different-email spelling still shows the specific message" */
    it("keeps mapping email_doesn't_match to the specific screen code", () => {
      expect(normalizeSignInErrorCode("email_doesn't_match")).toBe("DIFFERENT_EMAIL_NOT_ALLOWED");
      expect(signInErrorMayCross("email_doesn't_match")).toBe(true);
    });
  });

  describe("when the SSO plugin redirects with the sign-in refusal's raw spelling", () => {
    /** @scenario "The SSO plugin's spaced account-link spelling still shows the account-link message" */
    it("keeps mapping 'account not linked' to OAuthAccountNotLinked", () => {
      expect(normalizeSignInErrorCode("account not linked")).toBe("OAuthAccountNotLinked");
      expect(signInErrorMayCross("account not linked")).toBe(true);
    });
  });

  describe("when an address carries a spelling no release redirects with", () => {
    /** @scenario "A bookmarked error address with a retired spelling shows the generic error" */
    it.each(["LINKING_DIFFERENT_EMAILS_NOT_ALLOWED", "some_other_error"])(
      "leaves %s as it is, so it is withheld and the screen shows the generic error",
      (code) => {
        expect(normalizeSignInErrorCode(code)).toBe(code);
        expect(signInErrorMayCross(code)).toBe(false);
      },
    );
  });

  describe("when the code is one of the organization's cutover refusals", () => {
    /** @scenario "The organization's sign-in cutover codes are unchanged" */
    it.each(CUTOVER_SIGN_IN_ERROR_CODES)("returns %s as itself and keeps it stable", (code) => {
      expect(normalizeSignInErrorCode(code)).toBe(code);
      expect(isStableAuthError(code)).toBe(true);
      expect(signInErrorMayCross(code)).toBe(true);
    });
  });
});

describe("isStableAuthError", () => {
  describe("when the code is one somebody has to act on", () => {
    it.each(STABLE_AUTH_ERRORS)("treats %s as stable, so the screen does not bounce", (code) => {
      expect(isStableAuthError(code)).toBe(true);
    });
  });

  describe("when there is no code, or one a retry may clear", () => {
    it.each([null, undefined, "", "CredentialsSignin", "some_other_error"])(
      "treats %s as not stable",
      (code) => {
        expect(isStableAuthError(code)).toBe(false);
      },
    );
  });
});
