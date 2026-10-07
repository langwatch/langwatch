/**
 * The two sign-in security rules an organization sets, in the four columns it
 * owns: account lockout (GAC-09) and session limits (GAC-10).
 * specs/identity/org-account-lockout.feature, specs/identity/org-session-lifetime.feature
 */
import { z } from "zod";

export const signInSecurityPolicySchema = z.object({
  /** Consecutive failures before a lock. 0 = never lock. */
  lockoutAfterFailedAttempts: z.number().int().min(0).max(20),
  /** How long a lock lasts, in minutes. */
  lockoutMinutes: z.number().int().min(1).max(1440),
  /** Minutes a session may sit idle before it ends. 0 = no idle timeout. */
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080),
  /** Minutes from sign-in after which a session ends regardless. 0 = no ceiling. */
  sessionMaxLifetimeMinutes: z.number().int().min(0).max(10080),
});
export type SignInSecurityPolicy = z.infer<typeof signInSecurityPolicySchema>;
