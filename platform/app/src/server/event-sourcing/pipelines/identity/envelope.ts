import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  type IdentityCommand,
  type IdentityFactInput,
} from "@langwatch/identity";
import { createTenantId, EventUtils } from "../..";
import { eventIdempotencyKey } from "../../commands/idempotencyKey";
import { USER_IDENTITY_AGGREGATE_TYPE } from "./schemas/constants";
import type { IdentityEvent } from "./schemas/events";

/**
 * The ONE place an identity fact becomes a framework event: the guards
 * (`@langwatch/identity-server`) decide what a command states, and this
 * stamps the envelope from the command that produced it — the aggregate
 * type the store validates (#7406), the user as aggregate and tenant, the
 * command's business time, and the `commandId:index` idempotency key. Both
 * the pipeline's command handlers (the staged re-run) and the app's ledger
 * writer (the calling path) go through here, so the two legs cannot stamp
 * a fact differently.
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
