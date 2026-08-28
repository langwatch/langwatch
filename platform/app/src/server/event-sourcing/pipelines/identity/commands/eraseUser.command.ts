import {
  ERASE_USER_COMMAND_TYPE,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
} from "@langwatch/identity";
import type { IdentityGuards } from "@langwatch/identity-server";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { identityEventsFor } from "../envelope";
import type { IdentityEvent } from "../schemas/events";

/** The staged re-run: the calling path's guard, the calling path's envelope. */
export class EraseUserCommand
  implements CommandHandler<Command<EraseUserCommandData>, IdentityEvent>
{
  static readonly schema = defineCommandSchema(
    ERASE_USER_COMMAND_TYPE,
    eraseUserCommandDataSchema,
    "Record one user's erasure; the fold wipes values from their identifier rows",
  );

  static getAggregateId(payload: EraseUserCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuards) {}

  async handle(
    command: Command<EraseUserCommandData>,
  ): Promise<IdentityEvent[]> {
    const facts = await this.guards.eraseUser(command.data);
    return identityEventsFor({
      command: { type: ERASE_USER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
