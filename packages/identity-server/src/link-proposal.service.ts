import {
  CONFIRM_LINK_COMMAND_TYPE,
  type ConfirmLinkCommandData,
  confirmLinkCommandDataSchema,
  type IdentityFact,
  REJECT_LINK_COMMAND_TYPE,
  type RejectLinkCommandData,
  rejectLinkCommandDataSchema,
} from "@langwatch/identity";
import type { IdentityLedger } from "./identity-ledger";
import type { LinkProposalGuards } from "./link-proposal-guards";
import type { LinkProposalReadsRepository } from "./link-proposal.repository";

/**
 * How a confirmed proposal becomes a sign-in method.
 *
 * The SAME move an automatic link makes (`SignInCallbackLinkingService`):
 * the provider account is created through the directory, which fires the
 * account ceremony, which attaches the identifier through the pipeline.
 * Nothing here writes an `Account` row and nothing here attaches an
 * identifier, because a second way to claim a row is the risk the proposal
 * exists to remove.
 */
export interface LinkProposalDirectoryPort {
  linkProviderAccount(input: {
    userId: string;
    connectionId: string | null;
    provider: string;
    subject: string;
    normalizedEmail: string;
  }): Promise<void>;
}

export interface LinkProposalServiceDeps {
  guards: LinkProposalGuards;
  ledger: IdentityLedger;
  proposals: LinkProposalReadsRepository;
  directory: LinkProposalDirectoryPort;
}

/**
 * Deciding a waiting sign-in (ADR-117 §3, D05).
 *
 * Two verbs, and the asymmetry between them is the design: confirming makes
 * the link and then states that a human made it; rejecting states only that
 * a human refused, and touches nothing else. A rejection that also detached
 * something would be answering a question nobody asked.
 *
 * The order inside `confirm` is deliberate. The guard refuses a second
 * decision BEFORE anything happens; the link is made next; the fact is
 * stated last. A failure to link therefore leaves the proposal still
 * waiting, which is a state an operator can retry from — the reverse order
 * would leave a proposal marked confirmed that nobody may confirm again and
 * that nobody can sign in through.
 */
export class LinkProposalService {
  private readonly guards: LinkProposalGuards;
  private readonly ledger: IdentityLedger;
  private readonly proposals: LinkProposalReadsRepository;
  private readonly directory: LinkProposalDirectoryPort;

  constructor(deps: LinkProposalServiceDeps) {
    this.guards = deps.guards;
    this.ledger = deps.ledger;
    this.proposals = deps.proposals;
    this.directory = deps.directory;
  }

  async confirmLink(input: ConfirmLinkCommandData): Promise<IdentityFact[]> {
    const data = confirmLinkCommandDataSchema.parse(input);
    const facts = await this.guards.confirmLink(data);
    if (facts.length === 0) return [];

    // Re-read rather than thread the record out of the guard: the guard's
    // job is to refuse, and a guard that also returned the evidence for the
    // next step would be two jobs sharing one refusal.
    const proposal = await this.proposals.findProposal({
      userId: data.userId,
      proposalId: data.proposalId,
    });
    if (proposal?.value) {
      await this.directory.linkProviderAccount({
        userId: proposal.userId,
        connectionId: proposal.connectionId,
        provider: proposal.provider,
        subject: proposal.providerAccountId,
        normalizedEmail: proposal.value,
      });
    }

    return this.ledger.commit({
      command: { type: CONFIRM_LINK_COMMAND_TYPE, data },
      facts,
    });
  }

  async rejectLink(input: RejectLinkCommandData): Promise<IdentityFact[]> {
    const data = rejectLinkCommandDataSchema.parse(input);
    const facts = await this.guards.rejectLink(data);
    if (facts.length === 0) return [];
    return this.ledger.commit({
      command: { type: REJECT_LINK_COMMAND_TYPE, data },
      facts,
    });
  }
}
