import type { AuthApi } from "@langwatch/auth-contract";
import {
  CONFIRM_LINK_COMMAND_TYPE,
  type ConfirmLinkCommandData,
  confirmLinkCommandDataSchema,
  type IdentityFact,
  REJECT_LINK_COMMAND_TYPE,
  type RejectLinkCommandData,
  rejectLinkCommandDataSchema,
} from "@langwatch/identity-contract";

import type { IdentityHistoryRepository } from "../repositories/identity-history.repository.ts";
import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { LinkProposalGuardsService } from "./link-proposal-guards.service.ts";

/**
 * Deciding a waiting sign-in (ADR-117 §3, D05). Confirming guards, makes the link
 * through auth, then states the fact, so a failed link leaves the proposal waiting.
 * Rejecting states only that a human refused.
 */
export class LinkProposalService {
  static create(deps: {
    guards: LinkProposalGuardsService;
    ledger: IdentityLedger;
    proposals: IdentityHistoryRepository;
    accounts: Pick<AuthApi, "linkProviderAccount">;
  }): LinkProposalService {
    return new LinkProposalService(deps.guards, deps.ledger, deps.proposals, deps.accounts);
  }

  private constructor(
    private readonly guards: LinkProposalGuardsService,
    private readonly ledger: IdentityLedger,
    private readonly proposals: IdentityHistoryRepository,
    private readonly accounts: Pick<AuthApi, "linkProviderAccount">,
  ) {}

  async confirmLink(input: ConfirmLinkCommandData): Promise<IdentityFact[]> {
    const data = confirmLinkCommandDataSchema.parse(input);
    const facts = await this.guards.confirmLink(data);
    if (facts.length === 0) return [];

    const proposal = (await this.proposals.findProposals({ userId: data.userId })).find(
      (held) => held.proposalId === data.proposalId,
    );
    if (proposal?.value) {
      await this.accounts.linkProviderAccount({
        userId: proposal.userId,
        connectionId: proposal.connectionId,
        provider: proposal.provider,
        subject: proposal.providerAccountId,
        normalizedEmail: proposal.value,
      });
    }

    return this.ledger.commit({ command: { type: CONFIRM_LINK_COMMAND_TYPE, data }, facts });
  }

  async rejectLink(input: RejectLinkCommandData): Promise<IdentityFact[]> {
    const data = rejectLinkCommandDataSchema.parse(input);
    const facts = await this.guards.rejectLink(data);
    if (facts.length === 0) return [];
    return this.ledger.commit({ command: { type: REJECT_LINK_COMMAND_TYPE, data }, facts });
  }
}
