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
} from "@langwatch/identity-contract";
import type { IdentityGuardsService } from "./identity-guards.service";
import type { IdentityLedger } from "../rules/identity-ledger.rules";
import type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "../rules/identity-writes.rules";

/**
 * The identity write surface (ADR-101 §2, ADR-115 §3): six verbs, each
 */
export class IdentityService
  implements
    IdentityCeremonyWrites,
    IdentityVerificationWrites,
    IdentityAdoptionWrites,
    IdentityLinkProposalWrites
{
  static create(guards: IdentityGuardsService, ledger: IdentityLedger): IdentityService {
    return new IdentityService(guards, ledger);
  }

  private constructor(
    private readonly guards: IdentityGuardsService,
    private readonly ledger: IdentityLedger,
  ) {}

  async attachIdentifier(input: AttachIdentifierCommandData): Promise<IdentityFact[]> {
    const data = attachIdentifierCommandDataSchema.parse(input);

    return this.commit(
      { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data },
      await this.guards.attachIdentifier(data),
    );
  }

  async verifyIdentifier(input: VerifyIdentifierCommandData): Promise<IdentityFact[]> {
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

  async detachIdentifier(input: DetachIdentifierCommandData): Promise<IdentityFact[]> {
    const data = detachIdentifierCommandDataSchema.parse(input);

    return this.commit(
      { type: DETACH_IDENTIFIER_COMMAND_TYPE, data },
      await this.guards.detachIdentifier(data),
    );
  }

  async eraseUser(input: EraseUserCommandData): Promise<IdentityFact[]> {
    const data = eraseUserCommandDataSchema.parse(input);

    return this.commit({ type: ERASE_USER_COMMAND_TYPE, data }, await this.guards.eraseUser(data));
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
    facts: Awaited<ReturnType<IdentityGuardsService["attachIdentifier"]>>,
  ): Promise<IdentityFact[]> {
    if (facts.length === 0) {
      return [];
    }

    return this.ledger.commit({ command, facts });
  }
}
