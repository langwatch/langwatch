import {
  PROPOSE_LINK_COMMAND_TYPE,
  type ProposeLinkCommandData,
  proposeLinkCommandDataSchema,
} from "@langwatch/identity-contract";
import type { IdentityGuards } from "../guards";
import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import { identityEventsFor } from "../projections/identity-state.projection";
import type { IdentityEvent } from "../projections/identity-state.projection";

/**
 * The staged re-run of a link proposal (ADR-117 §3): the same guard the calling
 * path ran, the same envelope. A retried callback carries the same commandId,
 * so the re-run costs no second event.
 */
export class ProposeLinkCommand implements CommandHandler<
  Command<ProposeLinkCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    PROPOSE_LINK_COMMAND_TYPE,
    proposeLinkCommandDataSchema,
    "Record that an SSO callback's link needs a human to confirm it",
  );

  static getAggregateId(payload: ProposeLinkCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: IdentityGuards) {}

  async handle(command: Command<ProposeLinkCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.proposeLink(command.data);
    return identityEventsFor({
      command: { type: PROPOSE_LINK_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
