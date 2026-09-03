import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuards } from "../guards";
import {
  type Command,
  type CommandHandler,
  defineCommandSchema,
} from "@langwatch/eventing";
import { identityEventsFor } from "../projections/identity-state.projection";
import type { IdentityEvent } from "../projections/identity-state.projection";

/**
 * The staged re-run of an attach: the same guard the calling path ran
 * (`IdentityGuards`, one implementation), the same envelope. A fact the
 * heads already carry states nothing here, so a re-run costs no row.
 */
export class AttachIdentifierCommand
  implements CommandHandler<Command<AttachIdentifierCommandData>, IdentityEvent>
{
  static readonly schema = defineCommandSchema(
    ATTACH_IDENTIFIER_COMMAND_TYPE,
    attachIdentifierCommandDataSchema,
    "Attach one sign-in identifier to a user from a ceremony",
  );

  static getAggregateId(payload: AttachIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuards) {}

  async handle(
    command: Command<AttachIdentifierCommandData>,
  ): Promise<IdentityEvent[]> {
    const facts = await this.guards.attachIdentifier(command.data);
    return identityEventsFor({
      command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
