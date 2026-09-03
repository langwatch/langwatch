import type { BetterAuthOptions } from "better-auth";
import { SIGN_UP_CONFIRM_ADDRESS_PATH } from "../sign-up-confirmation";

export interface RateLimitDeps {
  /**
   * Whether the counters live in the shared store rather than in this pod's
   * memory. Distributed when the deployment has one, in-memory when it does
   * not — a limit counted per pod is still a limit.
   */
  hasSecondaryStorage: boolean;
}

/**
 * Rate limiting to mitigate credential stuffing / brute force on signin.
 * Defaults apply to every /api/auth/* path; customRules tighten the
 * credentials signin path specifically.
 */
export function rateLimit({
  hasSecondaryStorage,
}: RateLimitDeps): BetterAuthOptions["rateLimit"] {
  return {
    enabled: true,
    window: 60,
    max: 100,
    storage: hasSecondaryStorage ? "secondary-storage" : "memory",
    customRules: {
      "/sign-in/email": { window: 60 * 15, max: 30 },
      "/sign-up/email": { window: 60 * 60, max: 50 },
      "/sign-in/social": { window: 60 * 15, max: 50 },
      // BetterAuth's password reset endpoints are `request-password-reset`
      // and `reset-password`. The NextAuth-era rule named `/forget-password`
      // didn't match anything under BetterAuth — we ported it literally
      // during the migration without checking the new endpoint names. Fix
      // (iter 47 / bug 32): use the actual endpoint paths so the
      // 5-per-hour cap is enforced even though
      // `emailAndPassword.sendResetPassword` isn't configured (the endpoint
      // still returns 400 RESET_PASSWORD_DISABLED, but the rate limit
      // prevents using that response as an enumeration side-channel).
      "/request-password-reset": { window: 60 * 60, max: 5 },
      "/reset-password": { window: 60 * 60, max: 5 },
      // Passkey sign-up drops the session requirement from these two, so they
      // are an unauthenticated way to create an account and are limited as
      // one — alongside `/sign-up/email`, which is the same thing by another
      // door. Options are generated once per attempt and verification runs
      // only after a system prompt, so a person doing this by hand never
      // approaches either number.
      "/passkey/generate-register-options": { window: 60 * 60, max: 50 },
      "/passkey/verify-registration": { window: 60 * 60, max: 50 },
      // Spending a confirmation link opens a session, so it is limited as a
      // sign-in is. The same budget the tRPC procedure it replaced carried.
      [SIGN_UP_CONFIRM_ADDRESS_PATH]: { window: 60 * 60, max: 60 },
    },
  };
}
