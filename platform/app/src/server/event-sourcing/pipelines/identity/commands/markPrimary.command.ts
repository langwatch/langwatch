import {
  MARK_PRIMARY_COMMAND_TYPE,
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
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
export class MarkPrimaryCommand
  implements CommandHandler<Command<MarkPrimaryCommandData>, IdentityEvent>
{
  static readonly schema = defineCommandSchema(
    MARK_PRIMARY_COMMAND_TYPE,
    markPrimaryCommandDataSchema,
    "Make one VERIFIED identifier the user's PRIMARY",
  );

  static getAggregateId(payload: MarkPrimaryCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuards) {}

  async handle(
    command: Command<MarkPrimaryCommandData>,
  ): Promise<IdentityEvent[]> {
    const facts = await this.guards.markPrimary(command.data);
    return identityEventsFor({
      command: { type: MARK_PRIMARY_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
