/**
 * Two things a password reset has to do beyond changing the password: end every
 * session that was opened with the old one, and refuse to be a guessing gallery.
 * @see specs/auth/password-reset.feature
 */
import { describe, expect, it, vi } from "vitest";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers";

describe("the deployment's password reset", () => {
  describe("when a reset completes", () => {
    /** A password someone else knew is only really replaced once the sessions
     *  it opened are gone; leaving them live keeps the thief signed in.
     *  @scenario A successful reset revokes all of the user's existing sessions */
    it("ends every browser session the user had", async () => {
      const revokeAllBrowserSessions = vi.fn().mockResolvedValue(undefined);
      const auth = betterAuthTransportFor({}, { auth: { revokeAllBrowserSessions } as never });

      const onPasswordReset = auth.options.emailAndPassword?.onPasswordReset;
      expect(typeof onPasswordReset).toBe("function");

      await onPasswordReset!({ user: { id: "user_1", email: "a@acme.test" } } as never);

      expect(revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "user_1" });
    });
  });

  describe("when the reset endpoints are called repeatedly", () => {
    /** @scenario Password reset endpoints are rate-limited to five attempts per hour */
    it("caps both halves of the flow at five attempts an hour", () => {
      const rules = (
        betterAuthTransportFor().options.rateLimit as {
          customRules?: Record<string, { window: number; max: number }>;
        }
      ).customRules;

      expect(rules?.["/request-password-reset"]).toEqual({ window: 60 * 60, max: 5 });
      expect(rules?.["/reset-password"]).toEqual({ window: 60 * 60, max: 5 });
    });
  });
});
