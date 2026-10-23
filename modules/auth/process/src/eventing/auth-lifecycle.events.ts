import {
  APP_PAGE_OPENED_EVENT_TYPE,
  appPageOpenedEventDataSchema,
  SESSION_STARTED_EVENT_TYPE,
  sessionStartedEventDataSchema,
  SIGNED_UP_EVENT_TYPE,
  signedUpEventDataSchema,
  SSO_AUTO_ADDED_EVENT_TYPE,
  ssoAutoAddedEventDataSchema,
} from "@langwatch/auth-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** A person's sign-in milestones, ids only: a sign-up, a session minted, a domain auto-join. */
export const AUTH_LIFECYCLE_PIPELINE_NAME = "auth_lifecycle" as const;
export const AUTH_USER_AGGREGATE_TYPE = "user" as const;
export const AUTH_LIFECYCLE_EVENT_VERSION = "2026-09-29" as const;

export const RECORD_SESSION_STARTED_COMMAND_TYPE = "lw.auth.record_session_started" as const;
export const RECORD_SSO_AUTO_ADDED_COMMAND_TYPE = "lw.auth.record_sso_auto_added" as const;
export const RECORD_SIGNED_UP_COMMAND_TYPE = "lw.auth.record_signed_up" as const;
export const RECORD_APP_PAGE_OPENED_COMMAND_TYPE = "lw.auth.record_app_page_opened" as const;

/** A member of some organization minted a session; the tenant is the person. */
export const recordSessionStartedCommandDataSchema = sessionStartedEventDataSchema;
export type RecordSessionStartedCommandData = z.infer<typeof recordSessionStartedCommandDataSchema>;

/** A new person joined an organization through its email domain; the tenant is the organization. */
export const recordSsoAutoAddedCommandDataSchema = ssoAutoAddedEventDataSchema;
export type RecordSsoAutoAddedCommandData = z.infer<typeof recordSsoAutoAddedCommandDataSchema>;

/** A new person signed up through a ceremony auth runs; the tenant is the person. */
export const recordSignedUpCommandDataSchema = signedUpEventDataSchema;
export type RecordSignedUpCommandData = z.infer<typeof recordSignedUpCommandDataSchema>;

/** A person opened an app page in the browser; the tenant is the person. */
export const recordAppPageOpenedCommandDataSchema = appPageOpenedEventDataSchema;
export type RecordAppPageOpenedCommandData = z.infer<typeof recordAppPageOpenedCommandDataSchema>;

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
export const signedUpEventSchema = event(SIGNED_UP_EVENT_TYPE, recordSignedUpCommandDataSchema);
export const appPageOpenedEventSchema = event(
  APP_PAGE_OPENED_EVENT_TYPE,
  recordAppPageOpenedCommandDataSchema,
);
export type AppPageOpenedEvent = z.infer<typeof appPageOpenedEventSchema>;
export type SessionStartedEvent = z.infer<typeof sessionStartedEventSchema>;
export type SsoAutoAddedEvent = z.infer<typeof ssoAutoAddedEventSchema>;
export type SignedUpEvent = z.infer<typeof signedUpEventSchema>;
