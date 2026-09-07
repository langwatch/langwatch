import {
  SSO_CONNECTION_EVENT_VERSION_LATEST,
  type SsoConnectionCommand,
  type SsoConnectionFactInput,
} from "@langwatch/identity";
import { createTenantId, EventUtils } from "../..";
import { eventIdempotencyKey } from "../../commands/idempotencyKey";
import { SSO_CONNECTION_AGGREGATE_TYPE } from "./schemas/constants";
import type { SsoConnectionEvent } from "./schemas/events";

/**
 * The ONE place a connection fact becomes a framework event: the guards
 * (`@langwatch/identity-server`) decide what a command states, and this
 * stamps the envelope from the command that produced it — the aggregate type
 * the store validates (#7406), the connection as aggregate, the organization
 * as tenant, the command's business time, and the `commandId:index`
 * idempotency key.
 *
 * Both the pipeline's command handlers (the staged re-run) and the app's
 * ledger writer (the calling path) go through here, so the two legs cannot
 * stamp a fact differently — and the grandfather migration's second pass
 * derives the identical keys, which is the whole of its idempotency.
 */
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
