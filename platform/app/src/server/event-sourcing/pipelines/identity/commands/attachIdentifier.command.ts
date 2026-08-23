import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  arrivalStateForProvider,
  computeIdentifierHash,
  deriveIdentifierId,
  identifierDomain,
  normalizeIdentifierValue,
} from "../projections/identifierIdentity";
import {
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
} from "../schemas/commands";
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "../schemas/constants";
import type {
  IdentifierAttachedEvent,
  IdentifierDeadEndedEvent,
} from "../schemas/events";
import {
  eventIdempotencyKey,
  type IdentityGuardReads,
} from "./identityGuardReads";

export class AttachIdentifierCommand
  implements
    CommandHandler<
      Command<AttachIdentifierCommandData>,
      IdentifierAttachedEvent | IdentifierDeadEndedEvent
    >
{
  static readonly schema = defineCommandSchema(
    ATTACH_IDENTIFIER_COMMAND_TYPE,
    attachIdentifierCommandDataSchema,
    "Attach one sign-in identifier to a user from a ceremony",
  );

  static getAggregateId(payload: AttachIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly reads: IdentityGuardReads) {}

  async handle(
    command: Command<AttachIdentifierCommandData>,
  ): Promise<(IdentifierAttachedEvent | IdentifierDeadEndedEvent)[]> {
    const { userId, provider, providerAccountId, value, occurredAtMs } =
      command.data;
    const normalizedValue = normalizeIdentifierValue(value);
    const identifierId = deriveIdentifierId({
      userId,
      provider,
      providerAccountId,
      normalizedValue,
      occurredAtMs,
    });
    // A fact the heads already carry is not stated again (the #7429 rule,
    // applied where the fact is made): the staged re-run of a ceremony and
    // every backfill pass after the first both arrive here with the
    // identifier already folded, and must cost no event_log row. Dedupe at
    // the store is read-side — a restated row is still a row written.
    const state = await this.reads.loadIdentityState({ userId });
    if (state.identifiers[identifierId]) return [];
    const userHashKey = await this.reads.getUserHashKey({ userId });
    // Uniqueness of VERIFIED values is a command-time guard (D01). Non-email
    // providers arrive VERIFIED with no verify ceremony to re-check them, so
    // the attach itself is where a cross-user race resolves: the loser
    // arrives ATTACHED and dead-ends in the same emission, mirroring the
    // verify path's `uniqueness_race_lost`.
    const arrivalState = arrivalStateForProvider(provider);
    const holder =
      arrivalState !== "VERIFIED"
        ? null
        : await this.reads.findActiveIdentifierByValue({ normalizedValue });
    const isRaceLoser = holder !== null && holder.userId !== userId;
    const attached = (arrival: "ATTACHED" | "VERIFIED") =>
      attachedEvent({
        command,
        identifierId,
        normalizedValue,
        userHashKey,
        arrival,
      });
    if (isRaceLoser) {
      return [attached("ATTACHED"), deadEndedEvent({ command, identifierId })];
    }
    return [attached(arrivalState)];
  }
}

function attachedEvent({
  command,
  identifierId,
  normalizedValue,
  userHashKey,
  arrival,
}: {
  command: Command<AttachIdentifierCommandData>;
  identifierId: string;
  normalizedValue: string;
  userHashKey: string | null;
  arrival: "ATTACHED" | "VERIFIED";
}): IdentifierAttachedEvent {
  const {
    userId,
    commandId,
    accountId,
    provider,
    occurredAtMs,
    actor,
    ceremony,
  } = command.data;
  return EventUtils.createEvent<IdentifierAttachedEvent>({
    aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
    aggregateId: userId,
    tenantId: createTenantId(command.tenantId),
    type: IDENTIFIER_ATTACHED_EVENT_TYPE,
    version: IDENTITY_EVENT_VERSION_LATEST,
    data: {
      identifierId,
      userId,
      accountId,
      provider,
      value: normalizedValue,
      identifierHash:
        userHashKey === null
          ? null
          : computeIdentifierHash({ userHashKey, normalizedValue }),
      domain: identifierDomain(normalizedValue),
      connectionId: null,
      state: arrival,
      actor,
    },
    // The ceremony context the adapter stamped (ADR-101 §2: why the row
    // was written) rides as metadata - never in the fact itself.
    metadata: {
      ceremonyFlow: ceremony.flow,
      ...(ceremony.requestId ? { requestId: ceremony.requestId } : {}),
    },
    occurredAt: occurredAtMs,
    idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
  });
}

function deadEndedEvent({
  command,
  identifierId,
}: {
  command: Command<AttachIdentifierCommandData>;
  identifierId: string;
}): IdentifierDeadEndedEvent {
  const { userId, commandId, occurredAtMs, actor } = command.data;
  return EventUtils.createEvent<IdentifierDeadEndedEvent>({
    aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
    aggregateId: userId,
    tenantId: createTenantId(command.tenantId),
    type: IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
    version: IDENTITY_EVENT_VERSION_LATEST,
    data: { identifierId, reason: "uniqueness_race_lost", actor },
    metadata: {},
    occurredAt: occurredAtMs,
    idempotencyKey: eventIdempotencyKey({ commandId, index: 1 }),
  });
}
