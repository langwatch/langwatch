import {
  type IdentityActor,
  type SsoConnectionCommandType,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  SsoConnectionDomainTakenError,
  SsoConnectionInvalidTransitionError,
  SsoConnectionOperatorActRequiredError,
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  CLAIM_DOMAIN_COMMAND_TYPE,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
} from "@langwatch/identity-contract";

import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../repositories/sso-connection.repository.ts";

/**
 * The checks every SSO connection verb runs before it states a fact, and the reads those checks
 * are made of. Its own module so the verb list in `sso-connection-guards.service.ts` reads as
 * the lifecycle it enforces rather than as a lifecycle interleaved with its own plumbing.
 */

/** Which states each verb may be commanded from. The one place the diagram
 *  in `specs/identity/sso-connection-lifecycle.feature` is executable. */
const ALLOWED_FROM: Record<SsoConnectionCommandType, readonly SsoConnectionLifecycleState[]> = {
  [REGISTER_CONNECTION_COMMAND_TYPE]: [],
  [GRANDFATHER_CONNECTION_COMMAND_TYPE]: [],
  [CLAIM_DOMAIN_COMMAND_TYPE]: ["DRAFT", "REJECTED", "VERIFIED", "ACTIVE"],
  [APPROVE_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED"],
  [REJECT_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED"],
  [DISCARD_CONNECTION_COMMAND_TYPE]: ["DRAFT"],
  // From CLAIMED, because the published record is what DECIDES a claim: the
  // customer is given a record the moment they claim, and the proof landing
  // states the approval and the verification together. From APPROVED for the
  // tiers an operator or a licence already decided, and from
  // VERIFICATION_PENDING so an expired record can be asked for again.
  [REQUEST_VERIFICATION_COMMAND_TYPE]: ["CLAIMED", "APPROVED", "VERIFICATION_PENDING"],
  // Attestation replaces the PROOF, never the approval: it is commandable
  // from APPROVED and from nowhere else, which is what makes an attestation
  // against an unapproved claim a refusal rather than a shortcut.
  [ATTEST_DOMAIN_COMMAND_TYPE]: ["APPROVED"],
  [VERIFY_DOMAIN_COMMAND_TYPE]: ["VERIFICATION_PENDING"],
  // Any state a domain can be in. The verb's own guard narrows it further:
  // a VERIFIED domain on a routing connection is refused there.
  [WITHDRAW_DOMAIN_COMMAND_TYPE]: [
    "CLAIMED",
    "APPROVED",
    "VERIFICATION_PENDING",
    "REJECTED",
    "VERIFIED",
    "ACTIVE",
    "SUSPENDED",
  ],
  // Re-checking is for a connection whose domains are actually doing
  // something: one that reached VERIFIED and one serving traffic. A SUSPENDED
  // connection routes nothing and a TEARDOWN_PENDING one is on its way out.
  [RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE]: ["VERIFIED", "ACTIVE"],
  [RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE]: ["VERIFIED", "ACTIVE"],
  [ACTIVATE_CONNECTION_COMMAND_TYPE]: ["VERIFIED"],
  [SUSPEND_CONNECTION_COMMAND_TYPE]: ["ACTIVE"],
  [RESUME_CONNECTION_COMMAND_TYPE]: ["SUSPENDED"],
  [REQUEST_TEARDOWN_COMMAND_TYPE]: ["ACTIVE", "SUSPENDED"],
  [COMPLETE_TEARDOWN_COMMAND_TYPE]: ["TEARDOWN_PENDING"],
  // Decidable for as long as the connection can still admit anybody: before
  // it goes live, and after, because changing your mind is not a rebuild.
  [SET_ARRIVAL_POLICY_COMMAND_TYPE]: [
    "DRAFT",
    "CLAIMED",
    "APPROVED",
    "REJECTED",
    "VERIFICATION_PENDING",
    "VERIFIED",
    "ACTIVE",
    "SUSPENDED",
  ],
};

export interface SsoConnectionGuardsDeps {
  connections: SsoConnectionReadRepository;
  breakGlass: SsoBreakGlassBindingRepository;
  stranding: SsoConnectionStrandingRepository;
  platformOperators: SsoPlatformOperatorRepository;
}

export class SsoConnectionGuardChecksService {
  static create(deps: SsoConnectionGuardsDeps): SsoConnectionGuardChecksService {
    return new SsoConnectionGuardChecksService(deps);
  }

  private readonly connections: SsoConnectionReadRepository;
  private readonly breakGlass: SsoBreakGlassBindingRepository;
  private readonly stranding: SsoConnectionStrandingRepository;
  private readonly platformOperators: SsoPlatformOperatorRepository;

  private constructor(deps: SsoConnectionGuardsDeps) {
    this.connections = deps.connections;
    this.breakGlass = deps.breakGlass;
    this.stranding = deps.stranding;
    this.platformOperators = deps.platformOperators;
  }

  /** The connection as the fold currently holds it, or nothing. */
  tryFindConnection(input: { connectionId: string }): Promise<SsoConnectionState | null> {
    return this.connections.tryFindConnection(input);
  }

  /** Whether the organization has a live break-glass binding. */
  hasLiveBinding(input: { organizationId: string }): Promise<boolean> {
    return this.breakGlass.hasLiveBinding(input);
  }

  /** The users this connection's teardown would leave with no way in. */
  findStrandedUserIds(input: { connectionId: string }): Promise<string[]> {
    return this.stranding.findStrandedUserIds(input);
  }

  async require(
    data: { connectionId: string },
    command: SsoConnectionCommandType,
  ): Promise<SsoConnectionState> {
    const state = await this.connections.tryFindConnection({
      connectionId: data.connectionId,
    });
    if (!state) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId} does not exist`,
      );
    }

    if (!ALLOWED_FROM[command].includes(state.state)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: ${command} is not allowed from ${state.state}`,
      );
    }

    return state;
  }

  /**
   * The operator gate, asked of the port rather than of the command.
   */
  async assertPlatformOperator({
    actor,
    act,
  }: {
    actor: IdentityActor;
    act: string;
  }): Promise<void> {
    // A system actor is refused before the port is asked. These acts record
    // WHO decided, and an unattributable trust decision is precisely what the
    // attestation's visibility requirement forbids — so "the platform did it"
    // is not an answer either of them accepts.
    if (actor.type !== "user" || actor.id === null) {
      throw new SsoConnectionOperatorActRequiredError(
        `a ${actor.type} actor is not a platform operator and may not ${act}`,
      );
    }

    const isOperator = await this.platformOperators.isPlatformOperator({
      actorId: actor.id,
    });
    if (isOperator) {
      return;
    }

    throw new SsoConnectionOperatorActRequiredError(
      `actor ${actor.id} is not a platform operator and may not ${act}`,
    );
  }

  assertClaimed({ state, domain }: { state: SsoConnectionState; domain: string }): void {
    if (state.claimedDomains.includes(domain)) {
      return;
    }

    throw new SsoConnectionInvalidTransitionError(
      `connection ${state.connectionId}: ${domain} has no claim awaiting a decision`,
    );
  }

  async refuseIfDomainOwnedElsewhere({
    domain,
    connectionId,
  }: {
    domain: string;
    connectionId: string;
  }): Promise<void> {
    const owner = await this.connections.tryFindDomainOwner({ domain });
    if (owner && owner.connectionId !== connectionId) {
      throw new SsoConnectionDomainTakenError(
        `domain ${domain} is already verified on connection ${owner.connectionId}`,
      );
    }
  }
}
