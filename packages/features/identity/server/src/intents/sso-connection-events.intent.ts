import type { SsoConnectionCommand, SsoConnectionFactInput } from "@langwatch/identity-contract";
import {
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_EVENT_VERSION_LATEST,
} from "@langwatch/identity-contract";
import { createTenantId, eventIdempotencyKey, EventUtils } from "@langwatch/eventing";
import type { SsoConnectionEvent } from "../projections/sso-connection-state.projection.ts";

/** The one place an SSO connection fact becomes a framework event. */
export function ssoConnectionEventsFor({
  command,
  facts,
}: {
  command: SsoConnectionCommand;
  facts: SsoConnectionFactInput[];
}): SsoConnectionEvent[] {
  const { connectionId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
        aggregateId: connectionId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: SSO_CONNECTION_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as SsoConnectionEvent,
  );
}
