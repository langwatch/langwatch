import { type Command, type CommandHandler, defineCommandSchema } from "@langwatch/eventing";
import {
  CONFIRM_LINK_COMMAND_TYPE,
  type ConfirmLinkCommandData,
  confirmLinkCommandDataSchema,
  REJECT_LINK_COMMAND_TYPE,
  type RejectLinkCommandData,
  rejectLinkCommandDataSchema,
} from "@langwatch/identity-contract";

import type { LinkProposalGuardsService } from "../services/link-proposal-guards.service.ts";
import { identityEventsFor } from "./identity-events.intent.ts";
import type { IdentityEvent } from "./identity-state.projection.ts";

/**
 * The staged re-run of an operator's decision on a waiting sign-in (ADR-117 §3,
 * D05): the same guard the calling path ran, so a proposal cannot be decided twice.
 */
export class ConfirmLinkCommand implements CommandHandler<
  Command<ConfirmLinkCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    CONFIRM_LINK_COMMAND_TYPE,
    confirmLinkCommandDataSchema,
    "Record that a human confirmed a waiting sign-in",
  );

  static getAggregateId(payload: ConfirmLinkCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: LinkProposalGuardsService) {}

  async handle(command: Command<ConfirmLinkCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.confirmLink(command.data);
    return identityEventsFor({
      command: { type: CONFIRM_LINK_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}

export class RejectLinkCommand implements CommandHandler<
  Command<RejectLinkCommandData>,
  IdentityEvent
> {
  static readonly schema = defineCommandSchema(
    REJECT_LINK_COMMAND_TYPE,
    rejectLinkCommandDataSchema,
    "Record that a human refused a waiting sign-in",
  );

  static getAggregateId(payload: RejectLinkCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: LinkProposalGuardsService) {}

  async handle(command: Command<RejectLinkCommandData>): Promise<IdentityEvent[]> {
    const facts = await this.guards.rejectLink(command.data);
    return identityEventsFor({
      command: { type: REJECT_LINK_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
