import {
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuardsService } from "../services/identity-guards.service";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import type { IdentityEvent } from "../projections/identity-state.projection";
import { identityEventsFor } from "../intents/identity-events.intent";

/** The staged re-run: the calling path's guard, the calling path's envelope. */
export class VerifyIdentifierCommand implements CommandHandler<
  Command<VerifyIdentifierCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    VERIFY_IDENTIFIER_COMMAND_TYPE,
    verifyIdentifierCommandDataSchema,
    "Complete one identifier's verification ceremony",
  );

  static getAggregateId(payload: VerifyIdentifierCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuardsService) {}

  async handle(command: Command<VerifyIdentifierCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.verifyIdentifier(command.data);
    return identityEventsFor({
      command: { type: VERIFY_IDENTIFIER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
