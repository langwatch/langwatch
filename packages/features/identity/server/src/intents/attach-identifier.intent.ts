import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuardsService } from "../services/identity-guards.service.ts";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import type { IdentityEvent } from "../projections/identity-state.projection.ts";
import { identityEventsFor } from "../intents/identity-events.intent.ts";

/**
 * The staged re-run of an attach: the same guard the calling path ran
 * (`IdentityGuardsService`, one implementation), the same envelope. A fact the
 * heads already carry states nothing here, so a re-run costs no row.
 */
export class AttachIdentifierCommand implements CommandHandler<
  Command<AttachIdentifierCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    ATTACH_IDENTIFIER_COMMAND_TYPE,
    attachIdentifierCommandDataSchema,
    "Attach one sign-in identifier to a user from a ceremony",
  );

  static getAggregateId(payload: AttachIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuardsService) {}

  async handle(command: Command<AttachIdentifierCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.attachIdentifier(command.data);
    return identityEventsFor({
      command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
