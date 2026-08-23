import { createTenantId, defineCommandSchema, EventUtils } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import { eventIdempotencyKey } from "../../../commands/idempotencyKey";
import {
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
} from "../schemas/commands";
import {
  ERASE_USER_COMMAND_TYPE,
  IDENTITY_EVENT_VERSION_LATEST,
  USER_ERASED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "../schemas/constants";
import type { UserErasedEvent } from "../schemas/events";
import type { IdentityGuardReads } from "./identityGuardReads";

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
