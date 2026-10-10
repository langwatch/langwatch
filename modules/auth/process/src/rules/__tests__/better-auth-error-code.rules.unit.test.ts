/**
 * Which handled refusal each better-auth code on each route family answers as.
 * @see specs/identity/signin-signup-screens.feature
 */
import { describe, expect, it } from "vitest";

import { findRegisteredRefusals } from "../better-auth-error-code.rules.ts";

describe("given a better-auth credential refusal on the sign-in route", () => {
  describe("when the pair is rejected as a whole or the password alone", () => {
    /** @scenario The credential error boundary preserves one non-enumerating refusal */
    it("answers both with the one registered sign-in refusal", () => {
      const pair = findRegisteredRefusals({
        pathname: "/api/auth/sign-in/email",
        betterAuthCode: "INVALID_EMAIL_OR_PASSWORD",
      });
      const passwordOnly = findRegisteredRefusals({
        pathname: "/api/auth/sign-in/email",
        betterAuthCode: "INVALID_PASSWORD",
      });

      expect(pair).toHaveLength(1);
      expect(passwordOnly).toHaveLength(1);
      expect(new pair[0]!.error("refused").code).toBe("identity_sign_in_refused");
      expect(new passwordOnly[0]!.error("refused").code).toBe("identity_sign_in_refused");
    });
  });
});
