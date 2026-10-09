import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  type IdentityCommand,
  type IdentityFactInput,
  MFA_EVENT_VERSION_LATEST,
  type MfaCommand,
  type MfaFactInput,
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

/**
 * The same for two-step verification's facts (D06), and a separate function
 * for one reason that matters: SCHEMA VERSION. An envelope stamps exactly
 * one `version`, fold read-back is version-gated, and these two families
 * evolve independently. Folded into `identityEventsFor` every MFA event took
 * `IDENTITY_EVENT_VERSION_LATEST`, so an MFA payload change would have forced
 * an identifier-vocabulary bump and left every identifier event claiming a
 * schema version nothing in it had changed.
 *
 * They still ride `USER_IDENTITY_AGGREGATE_TYPE`, keyed on the same
 * `userId` — deliberately, and it is the whole reason this lives on the
 * identity pipeline. The queue keys its lane on the aggregate id, so a
 * person's identifier commands and their two-step commands serialise against
 * each other: a factor cannot be disabled while that person's last
 * identifier is being detached, and the strands guard cannot refuse on state
 * that went stale underneath it.
 *
 * An identifier answers WHO YOU ARE; a factor PROVES it. They share a lane
 * because they share a person, not because they are the same kind of thing —
 * which is also why they keep separate schemas, separate folds, and now
 * separate versions.
 */
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
