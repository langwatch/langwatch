/**
 * @vitest-environment node
 *
 * One reader of a failed credential sign-in for both doors. The sign-up screen
 * runs the same sign-in after it has created the account, so the words a
 * failure gets there must be the words the sign-in screen would use; only the
 * sentence for "nothing we recognise" differs, because by then the account
 * exists and saying the sign-up failed would send somebody to create it again.
 *
 * Corresponds to specs/auth/sign-in-failure-messages.feature.
 */
import { describe, expect, it } from "vitest";
import {
  credentialSignInFailure,
  describeRemainingWait,
} from "../credentialSignIn";

const SIGN_UP_FALLBACK =
  "Your account was created. Log in with your new details to carry on.";

describe("credentialSignInFailure", () => {
  describe("when the sign-in went through", () => {
    it("reports no failure", () => {
      expect(credentialSignInFailure({ response: { status: 200 } })).toBeNull();
      expect(credentialSignInFailure({ response: null })).toBeNull();
    });
  });

  describe("when the sign-up screen runs the sign-in leg and it fails", () => {
    /** @scenario Sign-up failures read the same way */
    it("gives a named failure the same words the sign-in screen gives it", () => {
      const refused = {
        error: "INVALID_EMAIL_OR_PASSWORD",
        code: "INVALID_EMAIL_OR_PASSWORD",
        status: 401,
      };

      const onSignUp = credentialSignInFailure({
        response: refused,
        fallback: SIGN_UP_FALLBACK,
      });
      const onSignIn = credentialSignInFailure({ response: refused });

      expect(onSignUp?.message).toBe(onSignIn?.message);
      expect(onSignUp?.message).not.toBe(SIGN_UP_FALLBACK);
      expect(onSignUp?.message).not.toContain("INVALID_EMAIL_OR_PASSWORD");
    });

    it("falls back to the sign-up's own sentence only when nothing is recognised", () => {
      const failure = credentialSignInFailure({
        response: { error: "SOMETHING_NEW", status: 400 },
        fallback: SIGN_UP_FALLBACK,
      });

      expect(failure?.message).toBe(SIGN_UP_FALLBACK);
    });
  });

  describe("when the refusal is a rate limit", () => {
    it("carries the remaining window only when the server sent one", () => {
      expect(
        credentialSignInFailure({
          response: {
            error: "Too many requests",
            status: 429,
            retryAfterSeconds: 90,
          },
        })?.retryAfterSeconds,
      ).toBe(90);
      expect(
        credentialSignInFailure({
          response: { error: "Too many requests", status: 429 },
        })?.retryAfterSeconds,
      ).toBeNull();
    });

    it("describes the wait the way a person counts it", () => {
      expect(describeRemainingWait(120)).toBe("Try again in 2 minutes.");
      expect(describeRemainingWait(61)).toBe("Try again in 2 minutes.");
      expect(describeRemainingWait(20)).toBe("Try again in 20 seconds.");
      expect(describeRemainingWait(1)).toBe("Try again in 1 second.");
    });
  });
});
