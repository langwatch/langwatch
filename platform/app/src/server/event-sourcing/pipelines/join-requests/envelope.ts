import {
  JOIN_REQUEST_EVENT_VERSION_LATEST,
  type JoinRequestCommand,
  type JoinRequestFactInput,
} from "@langwatch/identity";
import { createTenantId, EventUtils } from "../..";
import { eventIdempotencyKey } from "../../commands/idempotencyKey";
import { JOIN_REQUEST_AGGREGATE_TYPE } from "./schemas/constants";
import type { JoinRequestEvent } from "./schemas/events";

/**
 * The ONE place a join-request fact becomes a framework event: the guards
 * (`@langwatch/identity-server`) decide what a command states, and this
 * stamps the envelope from the command that produced it — the aggregate type
 * the store validates, the request as aggregate, the organization as tenant,
 * the command's business time, and the `commandId:index` idempotency key.
 *
 * Both the pipeline's command handlers (the staged re-run) and the app's
 * ledger writer (the calling path) go through here, so the two legs cannot
 * stamp a fact differently — and a retried approval derives identical keys,
 * which is the whole of "a replayed approval attaches membership exactly
 * once".
 */
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
