import {
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuards } from "../services/identity-guards.service";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import { IdentityStateFoldProjection } from "../projections/identity-state.projection";
import type { IdentityEvent } from "../projections/identity-state.projection";

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

  constructor(private readonly guards: IdentityGuards) {}

  async handle(command: Command<VerifyIdentifierCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.verifyIdentifier(command.data);
    return IdentityStateFoldProjection.eventsFor({
      command: { type: VERIFY_IDENTIFIER_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
