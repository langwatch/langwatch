import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  AUTH_LIFECYCLE_EVENT_VERSION,
  AUTH_USER_AGGREGATE_TYPE,
  RECORD_SESSION_STARTED_COMMAND_TYPE,
  RECORD_SSO_AUTO_ADDED_COMMAND_TYPE,
  type RecordSessionStartedCommandData,
  recordSessionStartedCommandDataSchema,
  type RecordSsoAutoAddedCommandData,
  recordSsoAutoAddedCommandDataSchema,
  SESSION_STARTED_EVENT_TYPE,
  type SessionStartedEvent,
  SSO_AUTO_ADDED_EVENT_TYPE,
  type SsoAutoAddedEvent,
} from "./auth-lifecycle.events.ts";

/** Records a minted session; each mint is its own event. */
export class RecordSessionStartedCommand implements CommandHandler<
  Command<RecordSessionStartedCommandData>,
  SessionStartedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SESSION_STARTED_COMMAND_TYPE,
    recordSessionStartedCommandDataSchema,
    "Record that a member of an organization started a session",
  );

  handle(command: Command<RecordSessionStartedCommandData>): SessionStartedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SessionStartedEvent>({
        aggregateType: AUTH_USER_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: SESSION_STARTED_EVENT_TYPE,
        version: AUTH_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.userId}:session_started:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSessionStartedCommandData): string {
    return payload.userId;
  }
}

/** Records a domain auto-join; one event per person and organization. */
export class RecordSsoAutoAddedCommand implements CommandHandler<
  Command<RecordSsoAutoAddedCommandData>,
  SsoAutoAddedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SSO_AUTO_ADDED_COMMAND_TYPE,
    recordSsoAutoAddedCommandDataSchema,
    "Record that a new person joined an organization through its email domain",
  );

  handle(command: Command<RecordSsoAutoAddedCommandData>): SsoAutoAddedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SsoAutoAddedEvent>({
        aggregateType: AUTH_USER_AGGREGATE_TYPE,
        aggregateId: data.userId,
        tenantId: createTenantId(command.tenantId),
        type: SSO_AUTO_ADDED_EVENT_TYPE,
        version: AUTH_LIFECYCLE_EVENT_VERSION,
        data,
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.userId}:sso_auto_added`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSsoAutoAddedCommandData): string {
    return payload.userId;
  }
}
