import {
  type ConfirmLinkCommandData,
  type IdentityFactInputOf,
  IdentityLinkProposalNotFoundError,
  IdentityLinkProposalResolvedError,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  type LinkProposalRecord,
  type RejectLinkCommandData,
} from "@langwatch/identity-contract";

import type { IdentityHistoryRepository } from "../repositories/identity-history.repository.ts";

/**
 * The guards over deciding a link proposal (ADR-117 §3, D05): a proposal is
 * decided once, and a second operator is told what the first decided.
 */
export class LinkProposalGuardsService {
  static create(deps: { proposals: IdentityHistoryRepository }): LinkProposalGuardsService {
    return new LinkProposalGuardsService(deps.proposals);
  }

  private constructor(private readonly proposals: IdentityHistoryRepository) {}

  async confirmLink(
    data: ConfirmLinkCommandData,
  ): Promise<IdentityFactInputOf<typeof LINK_CONFIRMED_EVENT_TYPE>[]> {
    const { userId, proposalId, actor } = data;
    await this.getUndecided({ userId, proposalId, verb: "confirm_link" });
    return [{ type: LINK_CONFIRMED_EVENT_TYPE, data: { proposalId, userId, actor } }];
  }

  async rejectLink(
    data: RejectLinkCommandData,
  ): Promise<IdentityFactInputOf<typeof LINK_REJECTED_EVENT_TYPE>[]> {
    const { userId, proposalId, actor } = data;
    await this.getUndecided({ userId, proposalId, verb: "reject_link" });
    return [{ type: LINK_REJECTED_EVENT_TYPE, data: { proposalId, userId, actor } }];
  }

  /** The proposal, undecided, or the refusal naming which of those is false. */
  private async getUndecided({
    userId,
    proposalId,
    verb,
  }: {
    userId: string;
    proposalId: string;
    verb: string;
  }): Promise<LinkProposalRecord> {
    const proposals = await this.proposals.findProposals({ userId });
    const proposal = proposals.find((held) => held.proposalId === proposalId);
    if (!proposal) {
      throw new IdentityLinkProposalNotFoundError(
        `${verb}: proposal ${proposalId} does not exist for this user`,
      );
    }
    if (proposal.decision) {
      throw new IdentityLinkProposalResolvedError(
        `${verb}: proposal ${proposalId} was already ${proposal.decision.outcome}`,
        { outcome: proposal.decision.outcome, byActorId: proposal.decision.byActorId },
      );
    }
    return proposal;
  }
}
