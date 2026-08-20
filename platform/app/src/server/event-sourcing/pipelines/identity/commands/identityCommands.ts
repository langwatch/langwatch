import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  arrivalStateForProvider,
  computeIdentifierHash,
  deriveIdentifierId,
  identifierDomain,
  normalizeIdentifierValue,
} from "../projections/identifierIdentity";
import type { IdentityLedgerState } from "../projections/reduceIdentity";
import {
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "../schemas/commands";
import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  ERASE_USER_COMMAND_TYPE,
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  MARK_PRIMARY_COMMAND_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  IdentifierAttachedEvent,
  IdentifierDeadEndedEvent,
  IdentifierDetachedEvent,
  IdentifierVerifiedEvent,
  PrimaryChangedEvent,
  UserErasedEvent,
} from "../schemas/events";

/**
 * The identity pipeline's commands (ADR-101 §2). Guards run HERE, before any
 * event exists — the veto-before-write half of the adapter contract — and
 * events are accepted facts the reducer folds without refusing. Every
 * emitted event's `idempotencyKey` is `<commandId>:<index>`, so a retried
 * command dedupes at the event store.
 *
 * The read ports below are how guards see current state. On the calling-path
 * dispatch the adapter uses (D01's pinned order: append waited → fold apply
 * on the calling path → staging best-effort), these reads are
 * read-your-writes against Postgres; on the staged path they run under the
 * queue's per-user FIFO, which serializes them against the fold.
 */

export interface IdentityGuardReads {
  /** The per-user HMAC key (`User.userHashKey`); null when not yet minted —
   *  the attach then records a null hash rather than failing the ceremony. */
  getUserHashKey(params: { userId: string }): Promise<string | null>;
  /** An ACTIVE (VERIFIED or PRIMARY) identifier holding this normalized
   *  value, whoever holds it — the cross-user uniqueness guard's read. */
  findActiveIdentifierByValue(params: {
    normalizedValue: string;
  }): Promise<{ userId: string; identifierId: string } | null>;
  /** The user's current identifier state, as the projection knows it. */
  loadIdentityState(params: { userId: string }): Promise<IdentityLedgerState>;
}

/**
 * A guard's refusal — thrown before any event exists, surfaced by the
 * dispatching ceremony (better-auth's own protocol flow once the adapter
 * lands). Assert on `code`, never the message.
 */
export class IdentityCommandRefusedError extends Error {
  constructor(
    readonly code:
      | "identity_identifier_not_found"
      | "identity_identifier_not_verifiable"
      | "identity_primary_must_demote_first"
      | "identity_primary_requires_verified",
    message: string,
  ) {
    super(message);
    this.name = "IdentityCommandRefusedError";
  }
}

function eventIdempotencyKey({
  commandId,
  index,
}: {
  commandId: string;
  index: number;
}): string {
  return `${commandId}:${index}`;
}

export class AttachIdentifierCommand
  implements
    CommandHandler<
      Command<AttachIdentifierCommandData>,
      IdentifierAttachedEvent
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
  ): Promise<IdentifierAttachedEvent[]> {
    const {
      userId,
      commandId,
      accountId,
      provider,
      providerAccountId,
      value,
      occurredAtMs,
      actor,
    } = command.data;
    const normalizedValue = normalizeIdentifierValue(value);
    const userHashKey = await this.reads.getUserHashKey({ userId });
    const identifierId = deriveIdentifierId({
      userId,
      provider,
      providerAccountId,
      normalizedValue,
      occurredAtMs,
    });
    return [
      EventUtils.createEvent<IdentifierAttachedEvent>({
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
          email: normalizedValue,
          identifierHash:
            userHashKey === null
              ? null
              : computeIdentifierHash({ userHashKey, normalizedValue }),
          domain: identifierDomain(normalizedValue),
          connectionId: null,
          state: arrivalStateForProvider(provider),
          actor,
        },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class VerifyIdentifierCommand
  implements
    CommandHandler<
      Command<VerifyIdentifierCommandData>,
      IdentifierVerifiedEvent | IdentifierDeadEndedEvent
    >
{
  static readonly schema = defineCommandSchema(
    VERIFY_IDENTIFIER_COMMAND_TYPE,
    verifyIdentifierCommandDataSchema,
    "Complete one identifier's verification ceremony",
  );

  static getAggregateId(payload: VerifyIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly reads: IdentityGuardReads) {}

  async handle(
    command: Command<VerifyIdentifierCommandData>,
  ): Promise<(IdentifierVerifiedEvent | IdentifierDeadEndedEvent)[]> {
    const {
      userId,
      commandId,
      identifierId,
      verificationId,
      method,
      occurredAtMs,
      actor,
    } = command.data;
    const state = await this.reads.loadIdentityState({ userId });
    const fact = state.identifiers[identifierId];
    if (!fact) {
      throw new IdentityCommandRefusedError(
        "identity_identifier_not_found",
        `verify_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // Already verified (or primary): nothing to record.
    if (fact.state === "VERIFIED" || fact.state === "PRIMARY") return [];
    if (fact.state !== "ATTACHED") {
      throw new IdentityCommandRefusedError(
        "identity_identifier_not_verifiable",
        `verify_identifier: identifier is ${fact.state}, only ATTACHED verifies`,
      );
    }
    // Uniqueness of VERIFIED values is a command-time guard re-checked here,
    // inside the command — concurrent verifies of the same value are
    // serialized by the per-user queue only within one user, so the loser of
    // a cross-user race dead-ends rather than verifying (D01). No DB unique
    // constraint backs this up: tombstones and replay make constraints lie.
    const holder =
      fact.value === null
        ? null
        : await this.reads.findActiveIdentifierByValue({
            normalizedValue: fact.value,
          });
    if (holder && holder.userId !== userId) {
      return [
        EventUtils.createEvent<IdentifierDeadEndedEvent>({
          aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
          aggregateId: userId,
          tenantId: createTenantId(command.tenantId),
          type: IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
          version: IDENTITY_EVENT_VERSION_LATEST,
          data: { identifierId, reason: "uniqueness_race_lost", actor },
          metadata: {},
          occurredAt: occurredAtMs,
          idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
        }),
      ];
    }
    return [
      EventUtils.createEvent<IdentifierVerifiedEvent>({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(command.tenantId),
        type: IDENTIFIER_VERIFIED_EVENT_TYPE,
        version: IDENTITY_EVENT_VERSION_LATEST,
        data: { identifierId, verificationId, method, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class MarkPrimaryCommand
  implements
    CommandHandler<Command<MarkPrimaryCommandData>, PrimaryChangedEvent>
{
  static readonly schema = defineCommandSchema(
    MARK_PRIMARY_COMMAND_TYPE,
    markPrimaryCommandDataSchema,
    "Make one VERIFIED identifier the user's PRIMARY",
  );

  static getAggregateId(payload: MarkPrimaryCommandData): string {
    return payload.userId;
  }

  constructor(private readonly reads: IdentityGuardReads) {}

  async handle(
    command: Command<MarkPrimaryCommandData>,
  ): Promise<PrimaryChangedEvent[]> {
    const { userId, commandId, identifierId, occurredAtMs, actor } =
      command.data;
    const state = await this.reads.loadIdentityState({ userId });
    const fact = state.identifiers[identifierId];
    if (!fact) {
      throw new IdentityCommandRefusedError(
        "identity_identifier_not_found",
        `mark_primary: identifier ${identifierId} does not exist for this user`,
      );
    }
    if (fact.state === "PRIMARY") return [];
    if (fact.state !== "VERIFIED") {
      throw new IdentityCommandRefusedError(
        "identity_primary_requires_verified",
        `mark_primary: identifier is ${fact.state}, only VERIFIED takes PRIMARY`,
      );
    }
    const previous = Object.values(state.identifiers).find(
      (candidate) => candidate.state === "PRIMARY",
    );
    return [
      EventUtils.createEvent<PrimaryChangedEvent>({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(command.tenantId),
        type: PRIMARY_CHANGED_EVENT_TYPE,
        version: IDENTITY_EVENT_VERSION_LATEST,
        data: {
          identifierId,
          previousIdentifierId: previous?.identifierId ?? null,
          actor,
        },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class DetachIdentifierCommand
  implements
    CommandHandler<
      Command<DetachIdentifierCommandData>,
      IdentifierDetachedEvent
    >
{
  static readonly schema = defineCommandSchema(
    DETACH_IDENTIFIER_COMMAND_TYPE,
    detachIdentifierCommandDataSchema,
    "Detach one identifier, leaving a forever-resolvable tombstone",
  );

  static getAggregateId(payload: DetachIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly reads: IdentityGuardReads) {}

  async handle(
    command: Command<DetachIdentifierCommandData>,
  ): Promise<IdentifierDetachedEvent[]> {
    const { userId, commandId, identifierId, occurredAtMs, actor } =
      command.data;
    const state = await this.reads.loadIdentityState({ userId });
    const fact = state.identifiers[identifierId];
    if (!fact) {
      throw new IdentityCommandRefusedError(
        "identity_identifier_not_found",
        `detach_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // PRIMARY never detaches directly — demote first (D01's state machine).
    if (fact.state === "PRIMARY") {
      throw new IdentityCommandRefusedError(
        "identity_primary_must_demote_first",
        "detach_identifier: the PRIMARY identifier must be demoted before it detaches",
      );
    }
    if (fact.state === "DETACHED") return [];
    return [
      EventUtils.createEvent<IdentifierDetachedEvent>({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(command.tenantId),
        type: IDENTIFIER_DETACHED_EVENT_TYPE,
        version: IDENTITY_EVENT_VERSION_LATEST,
        data: { identifierId, actor },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}

export class EraseUserCommand
  implements CommandHandler<Command<EraseUserCommandData>, UserErasedEvent>
{
  static readonly schema = defineCommandSchema(
    ERASE_USER_COMMAND_TYPE,
    eraseUserCommandDataSchema,
    "Record one user's erasure; the fold wipes values from their identifier rows",
  );

  static getAggregateId(payload: EraseUserCommandData): string {
    return payload.userId;
  }

  constructor(private readonly reads: IdentityGuardReads) {}

  async handle(
    command: Command<EraseUserCommandData>,
  ): Promise<UserErasedEvent[]> {
    const { userId, commandId, occurredAtMs, actor } = command.data;
    const state = await this.reads.loadIdentityState({ userId });
    // The event is the record that erasure happened; the ids are the
    // writer's audit list, not the sweep's bound (the fold wipes every
    // fact). The event-log mutation that wipes the user's PRIOR events, the
    // protocol-row deletions, and the userHashKey shred are the app-layer
    // erasure service's side-effects — sequenced around this command, not
    // inside it.
    return [
      EventUtils.createEvent<UserErasedEvent>({
        aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
        aggregateId: userId,
        tenantId: createTenantId(command.tenantId),
        type: USER_ERASED_EVENT_TYPE,
        version: IDENTITY_EVENT_VERSION_LATEST,
        data: {
          userId,
          erasedIdentifierIds: Object.keys(state.identifiers),
          actor,
        },
        metadata: {},
        occurredAt: occurredAtMs,
        idempotencyKey: eventIdempotencyKey({ commandId, index: 0 }),
      }),
    ];
  }
}
