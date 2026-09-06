import type { MfaCommand, MfaFactInput } from "@langwatch/identity-contract";
import {
  MFA_EVENT_VERSION_LATEST,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { createTenantId, eventIdempotencyKey, EventUtils } from "@langwatch/eventing";
import type { MfaEvent } from "../projections/mfa-enrollment-state.projection";

/** The one place an MFA enrollment fact becomes a framework event. */
export function mfaEventsFor({
  command,
  facts,
}: {
  command: MfaCommand;
  facts: MfaFactInput[];
}): MfaEvent[] {
  const { userId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: MFA_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as MfaEvent,
  );
}
