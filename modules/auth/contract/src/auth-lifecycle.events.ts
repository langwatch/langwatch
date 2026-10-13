import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A person's sign-in milestones, ids only, which peers react to from their own side (§9). */
export const SESSION_STARTED_EVENT_TYPE = "lw.auth.session_started" as const;
export const SSO_AUTO_ADDED_EVENT_TYPE = "lw.auth.sso_auto_added" as const;
/** A new person, from a Better Auth or passkey sign-up; nurturing derives signed_up. */
export const SIGNED_UP_EVENT_TYPE = "lw.auth.signed_up" as const;

/** A member of some organization minted a session; the tenant is the person. */
const sessionStartedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface SessionStartedEventDataSchema extends Named<
  typeof sessionStartedEventDataSchemaDefinition
> {}
export const sessionStartedEventDataSchema: SessionStartedEventDataSchema =
  sessionStartedEventDataSchemaDefinition;
export type SessionStartedEventData = z.infer<typeof sessionStartedEventDataSchema>;

/** A new person joined an organization through its email domain; the tenant is the organization. */
const ssoAutoAddedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export interface SsoAutoAddedEventDataSchema extends Named<
  typeof ssoAutoAddedEventDataSchemaDefinition
> {}
export const ssoAutoAddedEventDataSchema: SsoAutoAddedEventDataSchema =
  ssoAutoAddedEventDataSchemaDefinition;
export type SsoAutoAddedEventData = z.infer<typeof ssoAutoAddedEventDataSchema>;

/** A new person's account, minted by a sign-up auth ran; the tenant is the person. */
const signedUpEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface SignedUpEventDataSchema extends Named<typeof signedUpEventDataSchemaDefinition> {}
export const signedUpEventDataSchema: SignedUpEventDataSchema = signedUpEventDataSchemaDefinition;
export type SignedUpEventData = z.infer<typeof signedUpEventDataSchema>;
