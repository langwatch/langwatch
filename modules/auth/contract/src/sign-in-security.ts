/**
 * The two sign-in security rules an organization sets: account lockout (GAC-09)
 * and session limits (GAC-10). specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
import { z } from "zod";

export const signInSecuritySettingsSchema = z.object({
  /** Consecutive failures before a lock. 0 = never lock. */
  lockoutAfterFailedAttempts: z.number().int().min(0).max(20),
  /** How long a lock lasts, in minutes. */
  lockoutMinutes: z.number().int().min(1).max(1440),
  /** Minutes a session may sit idle before it ends. 0 = no idle timeout. */
  sessionIdleTimeoutMinutes: z.number().int().min(0).max(10080),
  /** Minutes from sign-in after which a session ends regardless. 0 = no ceiling. */
  sessionMaxLifetimeMinutes: z.number().int().min(0).max(10080),
});
export type SignInSecuritySettings = z.infer<typeof signInSecuritySettingsSchema>;

export const signInSecurityOrganizationInputSchema = z.object({
  organizationId: z.string().min(1),
});

export const saveSignInSecurityInputSchema = z.object({
  ...signInSecuritySettingsSchema.shape,
  organizationId: z.string().min(1),
});
export type SaveSignInSecurityInput = z.infer<typeof saveSignInSecurityInputSchema>;

export const saveSignInSecurityResultSchema = z.object({
  ok: z.literal(true),
  /** How many already-open sessions the new window ended. */
  sweptSessions: z.number().int().min(0),
});
export type SaveSignInSecurityResult = z.infer<typeof saveSignInSecurityResultSchema>;

export const releaseHeldAccountInputSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
});

export const releaseHeldAccountResultSchema = z.object({ released: z.boolean() });
export type ReleaseHeldAccountResult = z.infer<typeof releaseHeldAccountResultSchema>;

/** The refusal an organization on a lesser plan reads when it turns a rule on. */
export const SIGN_IN_SECURITY_ENTERPRISE_REFUSAL =
  "Sign-in security controls require an Enterprise plan";
