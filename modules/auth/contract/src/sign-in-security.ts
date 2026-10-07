/**
 * The two sign-in security rules an organization sets: account lockout (GAC-09)
 * and session limits (GAC-10). specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
import {
  signInSecurityPolicySchema,
  type SignInSecurityPolicy,
} from "@langwatch/organization-contract";
import { z } from "zod";

/** Organization owns the four columns and their shape; auth names it as its settings. */
export const signInSecuritySettingsSchema = signInSecurityPolicySchema;
export type SignInSecuritySettings = SignInSecurityPolicy;

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
