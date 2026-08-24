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
import type { MfaEvent } from "./schemas/mfaEvents";

/**
 * The ONE place an identity fact becomes a framework event: the guards
 * (`@langwatch/identity-server`) decide what a command states, and this
 * stamps the envelope from the command that produced it — the aggregate
 * type the store validates (#7406), the user as aggregate and tenant, the
 * command's business time, and the `commandId:index` idempotency key. Both
 * the pipeline's command handlers (the staged re-run) and the app's ledger
 * writer (the calling path) go through here, so the two legs cannot stamp
 * a fact differently.
 *
 * It stamps two-step verification's facts too (D06). They ride the same
 * aggregate — same person, same key — so they must ride the same envelope:
 * a parallel one stamping `user_identity` is precisely the divergence this
 * comment exists to rule out.
 *
 * The caller names which family it is stamping (`identityEventsFor<MfaEvent>`)
 * because the facts it passes decide that, and nothing in the signature can
 * infer it from an array. That is the one unchecked step, and it is here
 * rather than at seven call sites.
 */
export function identityEventsFor<
  E extends IdentityEvent | MfaEvent = IdentityEvent | MfaEvent,
>({
  command,
  facts,
}: {
  command: IdentityCommand;
  facts: IdentityFactInput[];
}): E[] {
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
      }) as E,
  );
}
