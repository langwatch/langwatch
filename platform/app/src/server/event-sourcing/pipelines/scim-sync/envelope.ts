import {
  SCIM_SYNC_EVENT_VERSION_LATEST,
  type ScimSyncCommand,
  type ScimSyncFactInput,
} from "@langwatch/identity";
import { createTenantId, EventUtils } from "../..";
import { eventIdempotencyKey } from "../../commands/idempotencyKey";
import { SCIM_SYNC_AGGREGATE_TYPE } from "./schemas/constants";
import type { ScimSyncEvent } from "./schemas/events";

/**
 * The ONE place a directory-sync fact becomes a framework event: the guards
 * (`@langwatch/identity-server`) decide what a command states, and this
 * stamps the envelope from the command that produced it — the aggregate type
 * the store validates (#7406), the sync as aggregate, the organization as
 * tenant, the command's business time, and the `commandId:index` idempotency
 * key.
 *
 * Both the pipeline's command handlers (the staged re-run) and the app's
 * ledger writer (the calling path) go through here, so the two legs cannot
 * stamp a fact differently.
 */
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
