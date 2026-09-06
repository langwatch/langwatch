import {
  ERASE_USER_COMMAND_TYPE,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import type { IdentityEvent } from "../projections/identity-state.projection.ts";
import { identityEventsFor } from "../intents/identity-events.intent.ts";

/** The staged re-run: the calling path's guard, the calling path's envelope. */
export class EraseUserCommand implements CommandHandler<
  Command<EraseUserCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    ERASE_USER_COMMAND_TYPE,
    eraseUserCommandDataSchema,
    "Record one user's erasure; the fold wipes values from their identifier rows",
  );

  static getAggregateId(payload: EraseUserCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuardsService) {}

  async handle(command: Command<EraseUserCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.eraseUser(command.data);
    return identityEventsFor({
      command: { type: ERASE_USER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
