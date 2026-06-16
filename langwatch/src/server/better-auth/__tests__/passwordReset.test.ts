import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the boundaries the reset callbacks reach for: the transactional mailer
// (SendGrid / SES) and the session-revocation helper (Postgres + Redis). The
// callbacks under test are the real ones wired into the `auth` instance.
vi.mock("../../mailer/resetPasswordEmail", () => ({
  sendResetPasswordEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../revokeSessions", () => ({
  revokeAllSessionsForUser: vi.fn().mockResolvedValue(undefined),
}));

import { env } from "~/env.mjs";
import { sendResetPasswordEmail } from "../../mailer/resetPasswordEmail";
import { auth } from "../index";
import { revokeAllSessionsForUser } from "../revokeSessions";

type EmailAndPasswordOptions = {
  sendResetPassword?: (args: {
    user: { id: string; email: string };
    url: string;
    token: string;
  }) => Promise<void>;
  onPasswordReset?: (args: {
    user: { id: string; email: string };
  }) => Promise<void>;
  resetPasswordTokenExpiresIn?: number;
};

const getEmailAndPassword = (): EmailAndPasswordOptions =>
  (auth as any).options.emailAndPassword as EmailAndPasswordOptions;

describe("better-auth password reset wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when BetterAuth invokes sendResetPassword", () => {
    /** @scenario The reset link is rooted at the deployment's own URL and carries the token */
    it("emails the user a reset link rooted at BASE_HOST carrying the token", async () => {
      const emailAndPassword = getEmailAndPassword();
      expect(typeof emailAndPassword.sendResetPassword).toBe("function");

      await emailAndPassword.sendResetPassword!({
        user: { id: "user_1", email: "forgot@acme.test" },
        url: "https://ignored.example/reset",
        token: "tok_test_123",
      });

      expect(sendResetPasswordEmail).toHaveBeenCalledTimes(1);
      expect(sendResetPasswordEmail).toHaveBeenCalledWith({
        email: "forgot@acme.test",
        resetUrl: `${env.BASE_HOST}/auth/reset-password?token=tok_test_123`,
      });
    });
  });

  describe("when BetterAuth invokes onPasswordReset", () => {
    /** @scenario A successful reset revokes all of the user's existing sessions */
    it("revokes every existing session for the user", async () => {
      const emailAndPassword = getEmailAndPassword();
      expect(typeof emailAndPassword.onPasswordReset).toBe("function");

      await emailAndPassword.onPasswordReset!({
        user: { id: "user_1", email: "forgot@acme.test" },
      });

      expect(revokeAllSessionsForUser).toHaveBeenCalledTimes(1);
      expect(revokeAllSessionsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_1" }),
      );
    });
  });

  describe("when the reset token lifetime is configured", () => {
    it("expires reset tokens after one hour", () => {
      const emailAndPassword = getEmailAndPassword();
      expect(emailAndPassword.resetPasswordTokenExpiresIn).toBe(60 * 60);
    });
  });

  describe("when the rate-limit configuration is inspected", () => {
    /** @scenario Password reset endpoints are rate-limited to five attempts per hour */
    it("caps /request-password-reset and /reset-password at 5 per hour", () => {
      const customRules = (auth as any).options.rateLimit.customRules as Record<
        string,
        { window: number; max: number }
      >;

      expect(customRules["/request-password-reset"]).toEqual({
        window: 60 * 60,
        max: 5,
      });
      expect(customRules["/reset-password"]).toEqual({
        window: 60 * 60,
        max: 5,
      });
    });
  });
});
