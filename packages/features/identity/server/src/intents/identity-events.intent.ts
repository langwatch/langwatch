import type { IdentityCommand, IdentityFactInput } from "@langwatch/identity-contract";
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { createTenantId, eventIdempotencyKey, EventUtils } from "@langwatch/eventing";
import type { IdentityEvent } from "../projections/identity-state.projection";

/**
 * The ONE place an identity fact becomes a framework event: the guards
 * (`IdentityGuardsService`) decide what a command states, and this stamps the
 * envelope, so both the staged re-run and the calling path stamp identically.
 */
export function identityEventsFor({
  command,
  facts,
}: {
  command: IdentityCommand;
  facts: IdentityFactInput[];
}): IdentityEvent[] {
  const { userId, tenantId, commandId, occurredAtMs } = command.data;
  // The ceremony context the adapter stamped (ADR-101 §2: why the row was
  // written) rides as metadata on the attach - never in the fact itself.
  const metadata =
    command.type === ATTACH_IDENTIFIER_COMMAND_TYPE
      ? {
          ceremonyFlow: command.data.ceremony.flow,
          ...(command.data.ceremony.requestId
            ? { requestId: command.data.ceremony.requestId }
            : {}),
        }
      : {};
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: IDENTITY_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata,
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as IdentityEvent,
  );
}
