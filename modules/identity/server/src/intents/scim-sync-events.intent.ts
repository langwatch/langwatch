import type { ScimSyncCommand, ScimSyncFactInput } from "@langwatch/identity-contract";
import {
  SCIM_SYNC_AGGREGATE_TYPE,
  SCIM_SYNC_EVENT_VERSION_LATEST,
} from "@langwatch/identity-contract";
import { createTenantId, eventIdempotencyKey, EventUtils } from "@langwatch/eventing";
import type { ScimSyncEvent } from "../projections/scim-sync-state.projection.ts";

/** The one place a SCIM sync fact becomes a framework event. */
export function scimSyncEventsFor({
  command,
  facts,
}: {
  command: ScimSyncCommand;
  facts: ScimSyncFactInput[];
}): ScimSyncEvent[] {
  const { scimSyncId, tenantId, commandId, occurredAtMs } = command.data;
  return facts.map(
    (fact, index) =>
      EventUtils.createEvent({
        aggregateType: SCIM_SYNC_AGGREGATE_TYPE,
        aggregateId: scimSyncId,
        tenantId: createTenantId(tenantId),
        type: fact.type,
        version: SCIM_SYNC_EVENT_VERSION_LATEST,
        data: fact.data,
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index }),
      }) as ScimSyncEvent,
  );
}
