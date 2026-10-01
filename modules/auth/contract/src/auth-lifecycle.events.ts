import { z } from "zod";

/** A person's sign-in milestones, ids only, which peers react to from their own side (§9). */
export const SESSION_STARTED_EVENT_TYPE = "lw.auth.session_started" as const;
export const SSO_AUTO_ADDED_EVENT_TYPE = "lw.auth.sso_auto_added" as const;

/** A member of some organization minted a session; the tenant is the person. */
export const sessionStartedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type SessionStartedEventData = z.infer<typeof sessionStartedEventDataSchema>;

/** A new person joined an organization through its email domain; the tenant is the organization. */
export const ssoAutoAddedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export type SsoAutoAddedEventData = z.infer<typeof ssoAutoAddedEventDataSchema>;
