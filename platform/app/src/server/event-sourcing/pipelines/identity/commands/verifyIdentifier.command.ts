import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "../schemas/commands";
import {
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  USER_IDENTITY_AGGREGATE_TYPE,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  IdentifierDeadEndedEvent,
  IdentifierVerifiedEvent,
} from "../schemas/events";
import {
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
} from "./identityCommandErrors";
import {
  eventIdempotencyKey,
  type IdentityGuardReads,
} from "./identityGuardReads";

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
      throw new IdentityIdentifierNotFoundError(
        `verify_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // Already verified (or primary): nothing to record.
    if (fact.state === "VERIFIED" || fact.state === "PRIMARY") return [];
    if (fact.state !== "ATTACHED") {
      throw new IdentityIdentifierNotVerifiableError(
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
