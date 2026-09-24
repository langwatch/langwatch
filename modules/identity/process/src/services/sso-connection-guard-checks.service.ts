import { HandledError } from "@langwatch/handled-error";
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
  REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  RENAME_CONNECTION_COMMAND_TYPE,
  SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  FINALIZE_MIGRATION_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  SsoConnectionAlreadyRegisteredError,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
} from "@langwatch/identity-contract";

import type {
  SsoConnectionRegistrationKind,
  SsoConnectionRegistrationRepository,
} from "../repositories/sso-connection-registration.repository.ts";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "../repositories/sso-connection.repository.ts";
import { isTerminalSsoConnection } from "../rules/sso-domain-ownership.rules.ts";

/**
 * The checks every SSO connection verb runs before it states a fact, and the reads those checks
 * are made of. Its own module so the verb list in `sso-connection-guards.service.ts` reads as
 * the lifecycle it enforces rather than as a lifecycle interleaved with its own plumbing.
 */

/** Which states each verb may be commanded from. The one place the diagram
 *  in `specs/identity/sso-connection-lifecycle.feature` is executable. */
const ALLOWED_FROM: Record<SsoConnectionCommandType, readonly SsoConnectionLifecycleState[]> = {
  [REGISTER_CONNECTION_COMMAND_TYPE]: [],
  [REGISTER_REPLACEMENT_CONNECTION_COMMAND_TYPE]: [],
  [GRANDFATHER_CONNECTION_COMMAND_TYPE]: [],
  // The migration verbs are commanded on the REPLACEMENT, which is live by
  // the time any of them is pressed: the route is chosen between two working
  // connections, and finalization retires the one nobody uses any more.
  [SELECT_MIGRATION_ROUTE_COMMAND_TYPE]: ["ACTIVE"],
  [BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE]: ["ACTIVE"],
  [FINALIZE_MIGRATION_COMMAND_TYPE]: ["ACTIVE"],
  [CLAIM_DOMAIN_COMMAND_TYPE]: ["DRAFT", "REJECTED", "VERIFIED", "ACTIVE"],
  // A second domain's progress is the domain's, not the connection's: a claim
  // on a VERIFIED or ACTIVE connection leaves it there, so the per-domain
  // verbs are commandable from those states and each checks the domain.
  [APPROVE_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED", "VERIFIED", "ACTIVE"],
  [REJECT_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED", "VERIFIED", "ACTIVE"],
  // Every state before the connection decides a sign-in: a setup nobody
  // finished is abandoned outright, whatever step it reached. From ACTIVE
  // onwards removal is teardown's, which owes people a grace.
  [DISCARD_CONNECTION_COMMAND_TYPE]: [
    "DRAFT",
    "CLAIMED",
    "APPROVED",
    "REJECTED",
    "VERIFICATION_PENDING",
    "VERIFIED",
  ],
  // From CLAIMED, because the published record is what DECIDES a claim: the
  // customer is given a record the moment they claim, and the proof landing
  // states the approval and the verification together. From APPROVED for the
  // tiers an operator or a licence already decided, and from
  // VERIFICATION_PENDING so an expired record can be asked for again.
  [REQUEST_VERIFICATION_COMMAND_TYPE]: [
    "CLAIMED",
    "APPROVED",
    "VERIFICATION_PENDING",
    "VERIFIED",
    "ACTIVE",
  ],
  // Attestation replaces the PROOF, never the approval: the verb refuses a
  // domain with no approved claim, whatever state the connection is in.
  [ATTEST_DOMAIN_COMMAND_TYPE]: ["APPROVED", "VERIFIED", "ACTIVE"],
  [VERIFY_DOMAIN_COMMAND_TYPE]: ["VERIFICATION_PENDING", "VERIFIED", "ACTIVE"],
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
  // TEARDOWN_PENDING too: asking again brings the date forward, and runs the
  // stranded-users check again on the way through.
  [REQUEST_TEARDOWN_COMMAND_TYPE]: ["ACTIVE", "SUSPENDED", "TEARDOWN_PENDING"],
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
  // Every state a card is read in, including the way out: a name is what an
  // administrator reads, nothing routes on it, and no saved link is keyed by
  // it — so correcting one is safe where no other change is.
  [RENAME_CONNECTION_COMMAND_TYPE]: [
    "DRAFT",
    "CLAIMED",
    "APPROVED",
    "REJECTED",
    "VERIFICATION_PENDING",
    "VERIFIED",
    "ACTIVE",
    "SUSPENDED",
    "TEARDOWN_PENDING",
  ],
};

export interface SsoConnectionGuardsDeps {
  connections: SsoConnectionReadRepository;
  registrationSlots: SsoConnectionRegistrationRepository;
  breakGlass: SsoBreakGlassBindingRepository;
  stranding: SsoConnectionStrandingRepository;
  platformOperators: SsoPlatformOperatorRepository;
}

export class SsoConnectionGuardChecksService {
  static create(deps: SsoConnectionGuardsDeps): SsoConnectionGuardChecksService {
    return new SsoConnectionGuardChecksService(deps);
  }

  private readonly connections: SsoConnectionReadRepository;
  private readonly registrationSlots: SsoConnectionRegistrationRepository;
  private readonly breakGlass: SsoBreakGlassBindingRepository;
  private readonly stranding: SsoConnectionStrandingRepository;
  private readonly platformOperators: SsoPlatformOperatorRepository;

  private constructor(deps: SsoConnectionGuardsDeps) {
    this.connections = deps.connections;
    this.registrationSlots = deps.registrationSlots;
    this.breakGlass = deps.breakGlass;
    this.stranding = deps.stranding;
    this.platformOperators = deps.platformOperators;
  }

  /**
   * One live connection of each kind per organization. The early refusal is
   * this read; the one that holds under concurrency is the slot claim.
   */
  async refuseCompetingConnection({
    organizationId,
    connectionId,
    kind,
    allowedConnectionId,
  }: {
    organizationId: string;
    connectionId: string;
    kind: SsoConnectionRegistrationKind;
    allowedConnectionId?: string;
  }): Promise<void> {
    const held = await this.connections.findForOrganization({ organizationId });
    const competing = held.find(
      (connection) =>
        !isTerminalSsoConnection(connection.state) &&
        connection.connectionId !== connectionId &&
        connection.connectionId !== allowedConnectionId,
    );
    if (competing === undefined) return;
    throw new SsoConnectionAlreadyRegisteredError(
      `organization ${organizationId} already holds ${kind} connection ${competing.connectionId} in ${competing.state}`,
    );
  }

  async claimRegistrationSlot(slot: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    kind: SsoConnectionRegistrationKind;
    replacesConnectionId: string | null;
  }): Promise<void> {
    const held = await this.registrationSlots.claim(slot);
    if (
      held.connectionId === slot.connectionId &&
      held.replacesConnectionId === slot.replacesConnectionId
    ) {
      return;
    }
    throw new SsoConnectionAlreadyRegisteredError(
      `organization ${slot.organizationId} already reserved its ${slot.kind} connection slot`,
    );
  }

  /** The connection as the fold currently holds it; `SsoConnectionNotFoundError` when none. */
  getConnection(input: { connectionId: string }): Promise<SsoConnectionState> {
    return this.connections.getConnection(input);
  }

  /** Every connection the organization holds, newest first. */
  findForOrganization(input: { organizationId: string }): Promise<SsoConnectionState[]> {
    return this.connections.findForOrganization(input);
  }

  /** Holds a live break-glass binding for one activation or resume. */
  reserveActivationRecovery(input: {
    organizationId: string;
    connectionId: string;
    commandId: string;
    nowMs: number;
  }): Promise<boolean> {
    return this.breakGlass.reserveActivationRecovery(input);
  }

  /** The users this connection's teardown would leave with no way in. */
  findStrandedUserIds(input: { connectionId: string }): Promise<string[]> {
    return this.stranding.findStrandedUserIds(input);
  }

  async require(
    data: { connectionId: string },
    command: SsoConnectionCommandType,
  ): Promise<SsoConnectionState> {
    const state = await this.connections
      .getConnection({ connectionId: data.connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") {
          throw new SsoConnectionInvalidTransitionError(
            `connection ${data.connectionId} does not exist`,
          );
        }
        throw error;
      });

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
    const owner = await this.connections.getDomainOwner({ domain }).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
      throw error;
    });
    if (owner && owner.connectionId !== connectionId) {
      throw new SsoConnectionDomainTakenError(
        `domain ${domain} is already verified on connection ${owner.connectionId}`,
      );
    }
  }
}
