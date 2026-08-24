import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  activateConnectionCommandDataSchema,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  approveDomainClaimCommandDataSchema,
  CLAIM_DOMAIN_COMMAND_TYPE,
  type ClaimDomainCommandData,
  claimDomainCommandDataSchema,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  type CompleteTeardownCommandData,
  completeTeardownCommandDataSchema,
  DISCARD_CONNECTION_COMMAND_TYPE,
  type DiscardConnectionCommandData,
  discardConnectionCommandDataSchema,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  type GrandfatherConnectionCommandData,
  grandfatherConnectionCommandDataSchema,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  type RegisterConnectionCommandData,
  registerConnectionCommandDataSchema,
  type RejectDomainClaimCommandData,
  rejectDomainClaimCommandDataSchema,
  type RequestTeardownCommandData,
  requestTeardownCommandDataSchema,
  type RequestVerificationCommandData,
  requestVerificationCommandDataSchema,
  type ResumeConnectionCommandData,
  resumeConnectionCommandDataSchema,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionFact,
  type SsoConnectionFactInput,
  type SuspendConnectionCommandData,
  suspendConnectionCommandDataSchema,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
  verifyDomainCommandDataSchema,
} from "@langwatch/identity";
import type { SsoConnectionGuards } from "./sso-connection-guards";
import type { SsoConnectionLedger } from "./sso-connection-ledger";

/**
 * The SSO connection write surface (D04, ADR-117 §5): thirteen verbs, each
 * the same move — parse the input, run the guard, hand the command and its
 * facts to the ledger.
 *
 * There is no other way to change a connection. The backoffice's ops
 * actions, the grandfather migration and D05's self-service all call these
 * methods; nothing anywhere writes an `SsoConnection` row directly, because
 * the row is a projection of this log and a hand-written one would be
 * overwritten by the next fold or the next replay. That is what "backoffice
 * edits go through commands like everyone else's" means mechanically: the
 * actor rides on every command, so the history says who did it.
 */
export class SsoConnectionService {
  constructor(
    private readonly guards: SsoConnectionGuards,
    private readonly ledger: SsoConnectionLedger,
  ) {}

  async registerConnection(
    input: RegisterConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = registerConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: REGISTER_CONNECTION_COMMAND_TYPE, data },
      await this.guards.registerConnection(data),
    );
  }

  async claimDomain(
    input: ClaimDomainCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = claimDomainCommandDataSchema.parse(input);
    return this.commit(
      { type: CLAIM_DOMAIN_COMMAND_TYPE, data },
      await this.guards.claimDomain(data),
    );
  }

  async approveDomainClaim(
    input: ApproveDomainClaimCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = approveDomainClaimCommandDataSchema.parse(input);
    return this.commit(
      { type: APPROVE_DOMAIN_CLAIM_COMMAND_TYPE, data },
      await this.guards.approveDomainClaim(data),
    );
  }

  async rejectDomainClaim(
    input: RejectDomainClaimCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = rejectDomainClaimCommandDataSchema.parse(input);
    return this.commit(
      { type: REJECT_DOMAIN_CLAIM_COMMAND_TYPE, data },
      await this.guards.rejectDomainClaim(data),
    );
  }

  async discardConnection(
    input: DiscardConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = discardConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: DISCARD_CONNECTION_COMMAND_TYPE, data },
      await this.guards.discardConnection(data),
    );
  }

  async requestVerification(
    input: RequestVerificationCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = requestVerificationCommandDataSchema.parse(input);
    return this.commit(
      { type: REQUEST_VERIFICATION_COMMAND_TYPE, data },
      await this.guards.requestVerification(data),
    );
  }

  async verifyDomain(
    input: VerifyDomainCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = verifyDomainCommandDataSchema.parse(input);
    return this.commit(
      { type: VERIFY_DOMAIN_COMMAND_TYPE, data },
      await this.guards.verifyDomain(data),
    );
  }

  async activateConnection(
    input: ActivateConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = activateConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: ACTIVATE_CONNECTION_COMMAND_TYPE, data },
      await this.guards.activateConnection(data),
    );
  }

  async suspendConnection(
    input: SuspendConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = suspendConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: SUSPEND_CONNECTION_COMMAND_TYPE, data },
      await this.guards.suspendConnection(data),
    );
  }

  async resumeConnection(
    input: ResumeConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = resumeConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: RESUME_CONNECTION_COMMAND_TYPE, data },
      await this.guards.resumeConnection(data),
    );
  }

  async requestTeardown(
    input: RequestTeardownCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = requestTeardownCommandDataSchema.parse(input);
    return this.commit(
      { type: REQUEST_TEARDOWN_COMMAND_TYPE, data },
      await this.guards.requestTeardown(data),
    );
  }

  async completeTeardown(
    input: CompleteTeardownCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = completeTeardownCommandDataSchema.parse(input);
    return this.commit(
      { type: COMPLETE_TEARDOWN_COMMAND_TYPE, data },
      await this.guards.completeTeardown(data),
    );
  }

  async grandfatherConnection(
    input: GrandfatherConnectionCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = grandfatherConnectionCommandDataSchema.parse(input);
    return this.commit(
      { type: GRANDFATHER_CONNECTION_COMMAND_TYPE, data },
      await this.guards.grandfatherConnection(data),
    );
  }

  private async commit(
    command: SsoConnectionCommand,
    facts: SsoConnectionFactInput[],
  ): Promise<SsoConnectionFact[]> {
    if (facts.length === 0) return [];
    return this.ledger.commit({ command, facts });
  }
}
