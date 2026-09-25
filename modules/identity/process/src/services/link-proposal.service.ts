import {
  type ConfirmLinkCommandData,
  confirmLinkCommandDataSchema,
  IdentityCapabilityUnavailableError,
  type IdentityFact,
  REJECT_LINK_COMMAND_TYPE,
  type RejectLinkCommandData,
  rejectLinkCommandDataSchema,
} from "@langwatch/identity-contract";

import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { LinkProposalGuardsService } from "./link-proposal-guards.service.ts";

/**
 * Deciding a waiting sign-in (ADR-117 §3, D05). Rejecting states only that a
 * human refused. Confirming must make the link BEFORE stating the fact, and the
 * link is auth's to make; until auth offers it, confirm refuses after the guard.
 */
export class LinkProposalService {
  static create(deps: {
    guards: LinkProposalGuardsService;
    ledger: IdentityLedger;
  }): LinkProposalService {
    return new LinkProposalService(deps.guards, deps.ledger);
  }

  private constructor(
    private readonly guards: LinkProposalGuardsService,
    private readonly ledger: IdentityLedger,
  ) {}

  /** Refuses a missing or decided proposal first, so the operator still learns which. */
  async confirmLink(input: ConfirmLinkCommandData): Promise<IdentityFact[]> {
    const data = confirmLinkCommandDataSchema.parse(input);
    await this.guards.confirmLink(data);
    throw new IdentityCapabilityUnavailableError("sign-in linking");
  }

  async rejectLink(input: RejectLinkCommandData): Promise<IdentityFact[]> {
    const data = rejectLinkCommandDataSchema.parse(input);
    const facts = await this.guards.rejectLink(data);
    if (facts.length === 0) return [];
    return this.ledger.commit({ command: { type: REJECT_LINK_COMMAND_TYPE, data }, facts });
  }
}
