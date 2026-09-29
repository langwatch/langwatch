import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** A person's sign-in milestones, ids only: a session minted, a domain auto-join. */
export const AUTH_LIFECYCLE_PIPELINE_NAME = "auth_lifecycle" as const;
export const AUTH_USER_AGGREGATE_TYPE = "user" as const;
export const AUTH_LIFECYCLE_EVENT_VERSION = "2026-09-29" as const;

export const SESSION_STARTED_EVENT_TYPE = "lw.auth.session_started" as const;
export const SSO_AUTO_ADDED_EVENT_TYPE = "lw.auth.sso_auto_added" as const;
export const RECORD_SESSION_STARTED_COMMAND_TYPE = "lw.auth.record_session_started" as const;
export const RECORD_SSO_AUTO_ADDED_COMMAND_TYPE = "lw.auth.record_sso_auto_added" as const;

/** A member of some organization minted a session; the tenant is the person. */
export const recordSessionStartedCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type RecordSessionStartedCommandData = z.infer<typeof recordSessionStartedCommandDataSchema>;

/** A new person joined an organization through its email domain; the tenant is the organization. */
export const recordSsoAutoAddedCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export type RecordSsoAutoAddedCommandData = z.infer<typeof recordSsoAutoAddedCommandDataSchema>;

const event = <Type extends string, Data extends z.ZodTypeAny>(type: Type, data: Data) =>
  z.object({
    ...EventSchema.shape,
    type: z.literal(type),
    version: z.literal(AUTH_LIFECYCLE_EVENT_VERSION),
    data,
  });

export const sessionStartedEventSchema = event(
  SESSION_STARTED_EVENT_TYPE,
  recordSessionStartedCommandDataSchema,
);
export const ssoAutoAddedEventSchema = event(
  SSO_AUTO_ADDED_EVENT_TYPE,
  recordSsoAutoAddedCommandDataSchema,
);
export type SessionStartedEvent = z.infer<typeof sessionStartedEventSchema>;
export type SsoAutoAddedEvent = z.infer<typeof ssoAutoAddedEventSchema>;
export type AuthLifecycleEvent = SessionStartedEvent | SsoAutoAddedEvent;
