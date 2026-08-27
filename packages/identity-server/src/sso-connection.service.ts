import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  activateConnectionCommandDataSchema,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  approveDomainClaimCommandDataSchema,
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  type WithdrawDomainCommandData,
  withdrawDomainCommandDataSchema,
  type AttestDomainCommandData,
  attestDomainCommandDataSchema,
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
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  type SetArrivalPolicyCommandData,
  setArrivalPolicyCommandDataSchema,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommand,
  type SsoConnectionFact,
  type SsoConnectionFactInput,
  type SuspendConnectionCommandData,
  suspendConnectionCommandDataSchema,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
  verifyDomainCommandDataSchema,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  type RecordDomainProofAbsentCommandData,
  type RecordDomainProofPresentCommandData,
  recordDomainProofAbsentCommandDataSchema,
  recordDomainProofPresentCommandDataSchema,
} from "@langwatch/identity";
import type { SsoConnectionGuards } from "./sso-connection-guards";
import type { SsoConnectionLedger } from "./sso-connection-ledger";

/**
 * The SSO connection write surface (D04, ADR-117 §5): fourteen verbs, each
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

  /** Tier 1's ceremony, in one verb: a platform operator states the domain is
   *  the organization's, and the connection is VERIFIED with nothing
   *  published anywhere. */
  async attestDomain(
    input: AttestDomainCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = attestDomainCommandDataSchema.parse(input);
    return this.commit(
      { type: ATTEST_DOMAIN_COMMAND_TYPE, data },
      await this.guards.attestDomain(data),
    );
  }

  /** Take a domain back out of the connection, wherever it stood. */
  async withdrawDomain(
    input: WithdrawDomainCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = withdrawDomainCommandDataSchema.parse(input);
    return this.commit(
      { type: WITHDRAW_DOMAIN_COMMAND_TYPE, data },
      await this.guards.withdrawDomain(data),
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

  /**
   * What a re-check saw (ADR-123). Both verbs are ordinary members of this
   * surface — a sweep changes a connection the same way a person does, through
   * a parsed command, a guard and the ledger — and both routinely commit
   * NOTHING, because the guard states a fact only when the world changed.
   */
  async recordDomainProofAbsent(
    input: RecordDomainProofAbsentCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = recordDomainProofAbsentCommandDataSchema.parse(input);
    return this.commit(
      { type: RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE, data },
      await this.guards.recordDomainProofAbsent(data),
    );
  }

  async recordDomainProofPresent(
    input: RecordDomainProofPresentCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = recordDomainProofPresentCommandDataSchema.parse(input);
    return this.commit(
      { type: RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE, data },
      await this.guards.recordDomainProofPresent(data),
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

  /** Who this connection admits (ADR-117 §3). */
  async setArrivalPolicy(
    input: SetArrivalPolicyCommandData,
  ): Promise<SsoConnectionFact[]> {
    const data = setArrivalPolicyCommandDataSchema.parse(input);
    return this.commit(
      { type: SET_ARRIVAL_POLICY_COMMAND_TYPE, data },
      await this.guards.setArrivalPolicy(data),
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
