import {
  DETACH_IDENTIFIER_COMMAND_TYPE,
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuards } from "../guards";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import { identityEventsFor } from "../projections/identity-state.projection";
import type { IdentityEvent } from "../projections/identity-state.projection";

/** The staged re-run: the calling path's guard, the calling path's envelope. */
export class DetachIdentifierCommand implements CommandHandler<
  Command<DetachIdentifierCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    DETACH_IDENTIFIER_COMMAND_TYPE,
    detachIdentifierCommandDataSchema,
    "Detach one identifier, leaving a forever-resolvable tombstone",
  );

  static getAggregateId(payload: DetachIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuards) {}

  async handle(command: Command<DetachIdentifierCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.detachIdentifier(command.data);
    return identityEventsFor({
      command: { type: DETACH_IDENTIFIER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
