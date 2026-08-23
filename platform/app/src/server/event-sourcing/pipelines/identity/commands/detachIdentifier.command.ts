import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import { eventIdempotencyKey } from "../../../commands/idempotencyKey";
import {
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
} from "../schemas/commands";
import {
  DETACH_IDENTIFIER_COMMAND_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "../schemas/constants";
import type { IdentifierDetachedEvent } from "../schemas/events";
import {
  IdentityIdentifierNotFoundError,
  IdentityPrimaryMustDemoteFirstError,
} from "./identityCommandErrors";
import type { IdentityGuardReads } from "./identityGuardReads";

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
      throw new IdentityIdentifierNotFoundError(
        `detach_identifier: identifier ${identifierId} does not exist for this user`,
      );
    }
    // PRIMARY never detaches directly — demote first (D01's state machine).
    if (fact.state === "PRIMARY") {
      throw new IdentityPrimaryMustDemoteFirstError(
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
