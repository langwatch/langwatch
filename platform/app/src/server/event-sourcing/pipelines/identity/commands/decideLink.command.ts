import {
  CONFIRM_LINK_COMMAND_TYPE,
  type ConfirmLinkCommandData,
  confirmLinkCommandDataSchema,
  REJECT_LINK_COMMAND_TYPE,
  type RejectLinkCommandData,
  rejectLinkCommandDataSchema,
} from "@langwatch/identity";
import type { LinkProposalGuards } from "@langwatch/identity-server";
import { defineCommandSchema } from "../../..";
import type { Command, CommandHandler } from "../../../commands/command";
import { identityEventsFor } from "../envelope";
import type { IdentityEvent } from "../schemas/events";

/**
 * The staged re-run of an operator's decision on a waiting sign-in (ADR-117
 * §3, D05): the same guard the calling path ran, the same envelope. A
 * retried decision carries the same commandId, so the re-run costs no second
 * event — and the guard refuses a genuine second decision either way.
 *
 * Both verbs live in one file because they are one decision with two
 * answers, and reading them apart hides that they share a guard.
 */
export class ConfirmLinkCommand
  implements CommandHandler<Command<ConfirmLinkCommandData>, IdentityEvent>
{
  static readonly schema = defineCommandSchema(
    CONFIRM_LINK_COMMAND_TYPE,
    confirmLinkCommandDataSchema,
    "Record that a human confirmed a waiting sign-in",
  );

  static getAggregateId(payload: ConfirmLinkCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: LinkProposalGuards) {}

  async handle(
    command: Command<ConfirmLinkCommandData>,
  ): Promise<IdentityEvent[]> {
    const facts = await this.guards.confirmLink(command.data);
    return identityEventsFor({
      command: { type: CONFIRM_LINK_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}

export class RejectLinkCommand
  implements CommandHandler<Command<RejectLinkCommandData>, IdentityEvent>
{
  static readonly schema = defineCommandSchema(
    REJECT_LINK_COMMAND_TYPE,
    rejectLinkCommandDataSchema,
    "Record that a human refused a waiting sign-in",
  );

  static getAggregateId(payload: RejectLinkCommandData): string {
    return payload.userId;
  }

  constructor(private readonly guards: LinkProposalGuards) {}

  async handle(
    command: Command<RejectLinkCommandData>,
  ): Promise<IdentityEvent[]> {
    const facts = await this.guards.rejectLink(command.data);
    return identityEventsFor({
      command: { type: REJECT_LINK_COMMAND_TYPE, data: command.data },
      facts,
    });
  }
}
