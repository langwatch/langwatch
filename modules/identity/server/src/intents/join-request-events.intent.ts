import type { JoinRequestCommand, JoinRequestFactInput } from "@langwatch/identity-contract";
import {
  JOIN_REQUEST_AGGREGATE_TYPE,
  JOIN_REQUEST_EVENT_VERSION_LATEST,
} from "@langwatch/identity-contract";
import { createTenantId, eventIdempotencyKey, EventUtils } from "@langwatch/eventing";
import type { JoinRequestEvent } from "../projections/join-request-state.projection.ts";

/** The one place a join-request fact becomes a framework event. */
export function joinRequestEventsFor({
  command,
  facts,
}: {
  command: JoinRequestCommand;
  facts: JoinRequestFactInput[];
}): JoinRequestEvent[] {
  const { joinRequestId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: JOIN_REQUEST_AGGREGATE_TYPE,
        aggregateId: joinRequestId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: JOIN_REQUEST_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as JoinRequestEvent,
  );
}
