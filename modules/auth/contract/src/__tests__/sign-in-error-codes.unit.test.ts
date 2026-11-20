/** @see specs/identity/scim-sso-signin.feature */
import { describe, expect, it } from "vitest";

import {
  CUTOVER_SIGN_IN_ERROR_CODES,
  isStableAuthError,
  normalizeSignInErrorCode,
  signInErrorMayCross,
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
    it.each(["LINKING_DIFFERENT_EMAILS_NOT_ALLOWED"])(
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
