import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  type AttachIdentifierCommandData,
  attachIdentifierCommandDataSchema,
  DETACH_IDENTIFIER_COMMAND_TYPE,
  type DetachIdentifierCommandData,
  detachIdentifierCommandDataSchema,
  ERASE_USER_COMMAND_TYPE,
  type EraseUserCommandData,
  eraseUserCommandDataSchema,
  type IdentityCommand,
  type IdentityFact,
  MARK_PRIMARY_COMMAND_TYPE,
  type MarkPrimaryCommandData,
  markPrimaryCommandDataSchema,
  PROPOSE_LINK_COMMAND_TYPE,
  type ProposeLinkCommandData,
  proposeLinkCommandDataSchema,
  VERIFY_IDENTIFIER_COMMAND_TYPE,
  type VerifyIdentifierCommandData,
  verifyIdentifierCommandDataSchema,
} from "@langwatch/identity";
import type { IdentityGuards } from "./guards";
import type { IdentityLedger } from "./identity-ledger";
import type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./identity-writes";

/**
 * The identity write surface (ADR-101 §2, ADR-115 §3): six verbs, each
 * the same move — parse the input, run the guard, hand the command and its
 * facts to the ledger. The guard vetoes before any fact exists; the ledger
 * (the app's) appends waited, folds on the calling path and stages last.
 * A verb whose guard states nothing (the heads already carry the fact)
 * returns without touching the ledger at all.
 */
export class IdentityService
  implements
    IdentityCeremonyWrites,
    IdentityVerificationWrites,
    IdentityAdoptionWrites,
    IdentityLinkProposalWrites
{
  constructor(
    private readonly guards: IdentityGuards,
    private readonly ledger: IdentityLedger,
  ) {}

  async attachIdentifier(
    input: AttachIdentifierCommandData,
  ): Promise<IdentityFact[]> {
    const data = attachIdentifierCommandDataSchema.parse(input);
    return this.commit(
      { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data },
      await this.guards.attachIdentifier(data),
    );
  }

  async verifyIdentifier(
    input: VerifyIdentifierCommandData,
  ): Promise<IdentityFact[]> {
    const data = verifyIdentifierCommandDataSchema.parse(input);
    return this.commit(
      { type: VERIFY_IDENTIFIER_COMMAND_TYPE, data },
      await this.guards.verifyIdentifier(data),
    );
  }

  async markPrimary(input: MarkPrimaryCommandData): Promise<IdentityFact[]> {
    const data = markPrimaryCommandDataSchema.parse(input);
    return this.commit(
      { type: MARK_PRIMARY_COMMAND_TYPE, data },
      await this.guards.markPrimary(data),
    );
  }

  async detachIdentifier(
    input: DetachIdentifierCommandData,
  ): Promise<IdentityFact[]> {
    const data = detachIdentifierCommandDataSchema.parse(input);
    return this.commit(
      { type: DETACH_IDENTIFIER_COMMAND_TYPE, data },
      await this.guards.detachIdentifier(data),
    );
  }

  async eraseUser(input: EraseUserCommandData): Promise<IdentityFact[]> {
    const data = eraseUserCommandDataSchema.parse(input);
    return this.commit(
      { type: ERASE_USER_COMMAND_TYPE, data },
      await this.guards.eraseUser(data),
    );
  }

  async proposeLink(input: ProposeLinkCommandData): Promise<IdentityFact[]> {
    const data = proposeLinkCommandDataSchema.parse(input);
    return this.commit(
      { type: PROPOSE_LINK_COMMAND_TYPE, data },
      await this.guards.proposeLink(data),
    );
  }

  private async commit(
    command: IdentityCommand,
    facts: Awaited<ReturnType<IdentityGuards["attachIdentifier"]>>,
  ): Promise<IdentityFact[]> {
    if (facts.length === 0) return [];
    // Every verb on this service is an IDENTIFIER verb, so the facts handed
    // back are exactly the ones handed in. The ledger's type is wider because
    // the aggregate also carries two-step verification (D06), which reaches
    // it through MfaGuards rather than through here.
    return (await this.ledger.commit({ command, facts })) as IdentityFact[];
  }
}
