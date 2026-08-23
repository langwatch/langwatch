import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import {
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
} from "../schemas/commands";
import {
  IDENTITY_EVENT_VERSION_LATEST,
  MARK_PRIMARY_COMMAND_TYPE,
  PRIMARY_CHANGED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "../schemas/constants";
import type { PrimaryChangedEvent } from "../schemas/events";
import {
  IdentityIdentifierNotFoundError,
  IdentityPrimaryRequiresVerifiedError,
} from "./identityCommandErrors";
import {
  eventIdempotencyKey,
  type IdentityGuardReads,
} from "./identityGuardReads";

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
      throw new IdentityIdentifierNotFoundError(
        `mark_primary: identifier ${identifierId} does not exist for this user`,
      );
    }
    if (fact.state === "PRIMARY") return [];
    if (fact.state !== "VERIFIED") {
      throw new IdentityPrimaryRequiresVerifiedError(
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
