import { HandledError } from "@langwatch/handled-error";
import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  type ApproveDomainClaimCommandData,
  type AttestDomainCommandData,
  type WithdrawDomainCommandData,
  type ClaimDomainCommandData,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  type CompleteTeardownCommandData,
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  type DiscardConnectionCommandData,
  type GrandfatherConnectionCommandData,
  type RecordDomainProofAbsentCommandData,
  type RecordDomainProofPresentCommandData,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  type RegisterConnectionCommandData,
  type RegisterReplacementConnectionCommandData,
  type RenameConnectionCommandData,
  type UpdateConnectionIdpCommandData,
  type SelectMigrationRouteCommandData,
  type BeginMigrationFinalizationCommandData,
  type FinalizeMigrationCommandData,
  qualifySsoDomainOwnership,
  SsoConnectionAlreadyRegisteredError,
  type RejectDomainClaimCommandData,
  type RequestTeardownCommandData,
  type RequestVerificationCommandData,
  type SetArrivalPolicyCommandData,
  type ResumeConnectionCommandData,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionFactInput,
  SsoConnectionActivationBlockedError,
  SsoConnectionInvalidTransitionError,
  SsoConnectionTeardownStrandsUsersError,
  type SuspendConnectionCommandData,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  type VerifyDomainCommandData,
} from "@langwatch/identity-contract";

import { SsoDomainClaimGuardsService } from "../../sso-domain/services/sso-domain-claim-guards.service.ts";
import { SsoDomainProofGuardsService } from "../../sso-domain/services/sso-domain-proof-guards.service.ts";
import { grandfatheredConnectionFacts } from "../rules/sso-connection-grandfather-facts.rules.ts";
import { activationRecoveryReservationId } from "../rules/sso-connection-id.rules.ts";
import { SsoConnectionEditGuardsService } from "./sso-connection-edit-guards.service.ts";
import {
  SsoConnectionGuardChecksService,
  type SsoConnectionGuardsDeps,
} from "./sso-connection-guard-checks.service.ts";

/**
 * The SSO connection guards (ADR-117 §5, D04): what runs BEFORE any fact
 */
export class SsoConnectionGuardsService {
  static create(deps: SsoConnectionGuardsDeps): SsoConnectionGuardsService {
    return new SsoConnectionGuardsService(deps);
  }

  private readonly checks: SsoConnectionGuardChecksService;
  private readonly claims: SsoDomainClaimGuardsService;
  private readonly proof: SsoDomainProofGuardsService;
  private readonly edits: SsoConnectionEditGuardsService;

  private constructor(deps: SsoConnectionGuardsDeps) {
    this.checks = SsoConnectionGuardChecksService.create(deps);
    this.claims = SsoDomainClaimGuardsService.create({ checks: this.checks });
    this.proof = SsoDomainProofGuardsService.create({ checks: this.checks });
    this.edits = SsoConnectionEditGuardsService.create({ checks: this.checks });
  }

  async registerConnection(data: RegisterConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const existing = await this.checks
      .getConnection({ connectionId: data.connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    // A retry of the same self-served registration states nothing; an id held
    // by anything else is refused rather than moved.
    if (existing) {
      if (
        existing.organizationId === data.organizationId &&
        existing.source === "self-serve" &&
        existing.replacesConnectionId === null
      ) {
        return [];
      }
      throw new SsoConnectionAlreadyRegisteredError(
        `connection ${data.connectionId} is already registered`,
      );
    }
    // The legacy history is the grandfather migration's to state, never an ordinary registration's.
    if (data.source !== "self-serve") {
      throw new SsoConnectionInvalidTransitionError(
        "ordinary registration may only create a self-serve connection",
      );
    }
    await this.checks.refuseCompetingConnection({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      kind: "direct",
    });
    await this.checks.claimRegistrationSlot({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      commandId: data.commandId,
      kind: "direct",
      replacesConnectionId: null,
    });

    return [
      {
        type: CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          type: data.type,
          idp: data.idp,
          arrivalPolicy: data.arrivalPolicy,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The legacy strings, stated as the history a connection would have had
   * (ADR-117 §5). It is the one verb that emits a whole lifecycle at once,
   */
  async grandfatherConnection(
    data: GrandfatherConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    // Only the migration itself may state a legacy history: a user-attributed
    // import would be an organization writing its own verified domains.
    if (
      data.source !== "legacy-grandfathered" ||
      data.actor.type !== "system" ||
      data.actor.id !== null
    ) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: legacy import requires the system migration actor`,
      );
    }
    const existing = await this.checks
      .getConnection({ connectionId: data.connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (existing) {
      return [];
    }
    await this.checks.refuseCompetingConnection({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      kind: "legacy",
    });
    await this.checks.claimRegistrationSlot({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      commandId: data.commandId,
      kind: "legacy",
      replacesConnectionId: null,
    });

    return grandfatheredConnectionFacts(data);
  }

  claimDomain(data: ClaimDomainCommandData): Promise<SsoConnectionFactInput[]> {
    return this.claims.claimDomain(data);
  }

  /**
   * Deciding a domain claim is a LangWatch operator's act, or on a self-hosted
   * installation its licence's; a published record decides only through `verifyDomain`.
   */
  approveDomainClaim(data: ApproveDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    return this.claims.approveDomainClaim(data);
  }

  /** The same decision with the opposite answer, so the same operator gate:
   *  a claim is decided by LangWatch or it is not decided. */
  rejectDomainClaim(data: RejectDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    return this.claims.rejectDomainClaim(data);
  }

  discardConnection(data: DiscardConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    return this.claims.discardConnection(data);
  }

  /**
   * The ceremony's opening move, and where first-verifier-owns is enforced.
   */
  requestVerification(data: RequestVerificationCommandData): Promise<SsoConnectionFactInput[]> {
    return this.proof.requestVerification(data);
  }

  /**
   * A platform operator states out of band that the domain is that organization's (D05 tier 1 /
   * D04 amendment). One step, APPROVED straight to VERIFIED, because nothing is published and
   * so nothing is pending.
   */
  attestDomain(data: AttestDomainCommandData): Promise<SsoConnectionFactInput[]> {
    return this.proof.attestDomain(data);
  }

  /**
   * A domain taken back out — a mistyped claim, a domain the company let go.
   * Refused for a VERIFIED domain on a connection that is deciding sign-in:
   * that is a connection to remove, not a domain to tidy.
   */
  withdrawDomain(data: WithdrawDomainCommandData): Promise<SsoConnectionFactInput[]> {
    return this.proof.withdrawDomain(data);
  }

  /**
   * The proof landed. Ownership is re-checked: the ceremony is not
   * instantaneous, and another organization's connection may have gone
   * ACTIVE on the same domain while this one was waiting for DNS.
   */
  verifyDomain(data: VerifyDomainCommandData): Promise<SsoConnectionFactInput[]> {
    return this.proof.verifyDomain(data);
  }

  /**
   * Somebody decided who this connection admits (ADR-117 §3). Idempotent by
   * state: re-stating the policy the connection already has says nothing,
   * so a screen that saves twice does not claim two decisions.
   */
  setArrivalPolicy(data: SetArrivalPolicyCommandData): Promise<SsoConnectionFactInput[]> {
    return this.claims.setArrivalPolicy(data);
  }

  /**
   * A re-check found the record gone (ADR-123). The first absence starts the
   * clock; a later one lapses only once the deadline the customer was TOLD
   * has passed, and an already-lapsed domain states nothing.
   */
  recordDomainProofAbsent(
    data: RecordDomainProofAbsentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    return this.proof.recordDomainProofAbsent(data);
  }

  /**
   * A re-check found the record published (ADR-123). Recovery is
   * unconditional and costs nothing beyond publishing it; a domain nothing
   * was doubting states nothing, which every healthy domain does.
   */
  recordDomainProofPresent(
    data: RecordDomainProofPresentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    return this.proof.recordDomainProofPresent(data);
  }

  /**
   * Activation's three preconditions, checked together (ADR-117 §5):
   */
  async activateConnection(data: ActivateConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, ACTIVATE_CONNECTION_COMMAND_TYPE);
    // Going live twice costs nothing and states nothing (sso-activation.feature).
    if (state.state === "ACTIVE") {
      return [];
    }
    const hasOwnershipProof = state.verifiedDomains.some(
      (domain) => qualifySsoDomainOwnership({ state, domain }).status === "QUALIFIED",
    );
    if (!hasOwnershipProof) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${data.connectionId}: no qualified domain ownership proof`,
      );
    }

    // No exemption for `legacy-grandfathered`, deliberately. A grandfathered
    // connection reaches ACTIVE because the migration STATED its history, not
    // because a guard let it through; any state change commanded afterwards
    // arrives here and is judged exactly like a self-served one's.
    if (data.testLoginAccountId === null) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${data.connectionId}: no recorded test login`,
      );
    }

    const reservationCommandId = activationRecoveryReservationId({
      organizationId: state.organizationId,
      connectionId: data.connectionId,
      actorType: data.actor.type,
      actorId: data.actor.id,
      connectionUpdatedAtMs: state.updatedAtMs,
      transition: "activate",
    });
    const bound = await this.checks.reserveActivationRecovery({
      organizationId: state.organizationId,
      connectionId: data.connectionId,
      commandId: reservationCommandId,
      nowMs: data.occurredAtMs,
    });
    if (!bound) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${data.connectionId}: no live break-glass binding for organization ${state.organizationId}`,
      );
    }

    return [
      {
        type: CONNECTION_ACTIVATED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          activationReservationCommandId: reservationCommandId,
          testLoginAccountId: data.testLoginAccountId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** Always available: suspension is the lever an operator reaches for when
   *  a connection is actively hurting people, so it has no preconditions
   *  beyond being ACTIVE. */
  async suspendConnection(data: SuspendConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    await this.checks.require(data, SUSPEND_CONNECTION_COMMAND_TYPE);

    return [
      {
        type: CONNECTION_SUSPENDED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          reason: data.reason,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  async resumeConnection(data: ResumeConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, RESUME_CONNECTION_COMMAND_TYPE);
    // Resuming routes sign-ins again, so it needs the same way back in activation did.
    const reservationCommandId = activationRecoveryReservationId({
      organizationId: state.organizationId,
      connectionId: data.connectionId,
      actorType: data.actor.type,
      actorId: data.actor.id,
      connectionUpdatedAtMs: state.updatedAtMs,
      transition: "resume",
    });
    const bound = await this.checks.reserveActivationRecovery({
      organizationId: state.organizationId,
      connectionId: data.connectionId,
      commandId: reservationCommandId,
      nowMs: data.occurredAtMs,
    });
    if (!bound) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${data.connectionId}: no live break-glass binding for organization ${state.organizationId}`,
      );
    }

    return [
      {
        type: CONNECTION_RESUMED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          activationReservationCommandId: reservationCommandId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * Teardown never strands a user. The read is over the identity heads: a user whose only live
   * identifiers belong to this connection has no other way in, and removing it would turn a
   * configuration change into an account loss.
   */
  async requestTeardown(data: RequestTeardownCommandData): Promise<SsoConnectionFactInput[]> {
    await this.checks.require(data, REQUEST_TEARDOWN_COMMAND_TYPE);
    const stranded = await this.checks.findStrandedUserIds({
      connectionId: data.connectionId,
    });
    if (stranded.length > 0) {
      throw new SsoConnectionTeardownStrandsUsersError(
        `connection ${data.connectionId}: ${stranded.length} user(s) hold no other verified sign-in method`,
      );
    }

    return [
      {
        type: TEARDOWN_REQUESTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          reason: data.reason,
          tearDownAfterMs: data.occurredAtMs + data.graceMs,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The process manager's wake dispatches this once the grace has elapsed. The deadline is
   * re-read from the folded state rather than trusted from the wake: a lagged wake, a replayed
   * job or a hand-run command must not be able to complete a teardown early.
   */
  async completeTeardown(data: CompleteTeardownCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, COMPLETE_TEARDOWN_COMMAND_TYPE);
    const deadline = state.tearDownAfterMs;
    if (deadline !== null && data.occurredAtMs < deadline) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: teardown grace has not elapsed`,
      );
    }

    return [
      {
        type: CONNECTION_TORN_DOWN_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** The word on the card. Renaming to the name it already has costs no
   *  fact: unlike the arrival policy, there is no "somebody has decided" for
   *  a name to be evidence of. */
  renameConnection(data: RenameConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    return this.edits.renameConnection(data);
  }

  /**
   * The dialing information, replaced on the same connection id; the caller checked
   * and stored the values. Grandfathered connections and protocol changes are
   * refused, and identical settings cost no fact.
   */
  updateConnectionIdp(data: UpdateConnectionIdpCommandData): Promise<SsoConnectionFactInput[]> {
    return this.edits.updateConnectionIdp(data);
  }

  /**
   * The one direct replacement an organization may run beside its
   * grandfathered connection. The proofs that still qualify come with it, so
   * a customer never re-proves a domain they have already proved.
   */
  registerReplacementConnection(
    data: RegisterReplacementConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    return this.edits.registerReplacementConnection(data);
  }

  /** Frees the registration slot a command claimed when its commit failed before staging. */
  releaseRegistrationSlot(claim: { organizationId: string; commandId: string }): Promise<void> {
    return this.checks.releaseRegistrationSlot(claim);
  }

  /** Which of the pair decides an ordinary sign-in. Locked once finalization
   *  has started: past that point the legacy route is being dismantled. */
  selectMigrationRoute(data: SelectMigrationRouteCommandData): Promise<SsoConnectionFactInput[]> {
    return this.edits.selectMigrationRoute(data);
  }

  /** The durable gate: it lands BEFORE any account is removed, so a process
   *  that dies mid-retirement resumes instead of pretending it finished. */
  beginMigrationFinalization(
    data: BeginMigrationFinalizationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    return this.edits.beginMigrationFinalization(data);
  }

  finalizeMigration(data: FinalizeMigrationCommandData): Promise<SsoConnectionFactInput[]> {
    return this.edits.finalizeMigration(data);
  }
}
