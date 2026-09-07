import {
  type ConfirmLinkCommandData,
  IdentityLinkProposalNotFoundError,
  IdentityLinkProposalResolvedError,
  type IdentityFactInput,
  LINK_CONFIRMED_EVENT_TYPE,
  LINK_REJECTED_EVENT_TYPE,
  type RejectLinkCommandData,
} from "@langwatch/identity";
import type {
  LinkProposalReadsRepository,
  LinkProposalRecord,
} from "./link-proposal.repository";

/**
 * The guards over deciding a link proposal (ADR-117 §3, D05).
 *
 * A class of its own rather than two more methods on `IdentityGuards`, for
 * the reason `SsoConnectionGuards` and `JoinRequestGuards` are their own:
 * these two verbs read something the identity heads do not carry. A proposal
 * changes no head, so the heads can never answer whether one was already
 * decided — and a guard reading a port its siblings do not need is a guard
 * that belongs beside that port.
 *
 * One rule, and it is the whole reason this exists: a proposal is decided
 * once. Two operators working the same support case is not an edge case,
 * it is Tuesday, and the second one has to be told what the first did rather
 * than silently overwriting it.
 */
export class LinkProposalGuards {
  constructor(
    private readonly deps: { proposals: LinkProposalReadsRepository },
  ) {}

  async confirmLink(data: ConfirmLinkCommandData): Promise<IdentityFactInput[]> {
    const { userId, proposalId, actor } = data;
    await this.requireUndecided({ userId, proposalId, verb: "confirm_link" });
    return [
      {
        type: LINK_CONFIRMED_EVENT_TYPE,
        data: { proposalId, userId, actor },
      },
    ];
  }

  async rejectLink(data: RejectLinkCommandData): Promise<IdentityFactInput[]> {
    const { userId, proposalId, actor } = data;
    await this.requireUndecided({ userId, proposalId, verb: "reject_link" });
    return [
      {
        type: LINK_REJECTED_EVENT_TYPE,
        data: { proposalId, userId, actor },
      },
    ];
  }

  /**
   * The proposal exists and nobody has decided it, or the refusal that says
   * which of those two is false. The decision travels on the error rather
   * than only in its detail: the words an operator reads have to name what
   * was decided and by whom.
   */
  private async requireUndecided({
    userId,
    proposalId,
    verb,
  }: {
    userId: string;
    proposalId: string;
    verb: string;
  }): Promise<LinkProposalRecord> {
    const proposal = await this.deps.proposals.findProposal({
      userId,
      proposalId,
    });
    if (!proposal) {
      throw new IdentityLinkProposalNotFoundError(
        `${verb}: proposal ${proposalId} does not exist for this user`,
      );
    }
    if (proposal.decision) {
      throw new IdentityLinkProposalResolvedError(
        `${verb}: proposal ${proposalId} was already ${proposal.decision.outcome}`,
        {
          outcome: proposal.decision.outcome,
          byActorId: proposal.decision.byActorId,
        },
      );
    }
    return proposal;
  }
}
