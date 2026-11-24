/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { cutoverSignInRefusal } from "../sign-in-error-code.ts";

describe("a sign-in the organization's move refused", () => {
  describe("when the old way in has been retired", () => {
    it("says so in words about their sign-in", () => {
      expect(cutoverSignInRefusal("SSO_LEGACY_AUTH_RETIRED")).toEqual({
        title: "Your organization moved its sign-in",
        body: expect.stringContaining("retired"),
      });
    });
  });

  describe("when the session itself was refused mid-cutover", () => {
    it.each(["SSO_MIGRATION_AUTH_NOT_ALLOWED", "SSO_MIGRATION_AUTH_AMBIGUOUS"])(
      "has words for %s",
      (code) => {
        expect(cutoverSignInRefusal(code)?.title).toBeTruthy();
      },
    );
  });

  describe("when the code names no refusal of ours", () => {
    it("has no words to put under our branding", () => {
      expect(cutoverSignInRefusal("some_other_error")).toBeUndefined();
    });
  });
});
