import { HandledError } from "@langwatch/handled-error";
import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  type AttestDomainCommandData,
  type WithdrawDomainCommandData,
  CLAIM_DOMAIN_COMMAND_TYPE,
  type ClaimDomainCommandData,
  domainClaimRetryAfterSeconds,
  isClaimableSsoDomain,
  SsoDomainClaimThrottledError,
  SsoDomainNotEligibleError,
  COMPLETE_TEARDOWN_COMMAND_TYPE,
  type CompleteTeardownCommandData,
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_DISCARDED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  CONNECTION_TORN_DOWN_EVENT_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  type DiscardConnectionCommandData,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  type GrandfatherConnectionCommandData,
  normalizeDomain,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  type RecordDomainProofAbsentCommandData,
  type RecordDomainProofPresentCommandData,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  type RegisterConnectionCommandData,
  type RegisterReplacementConnectionCommandData,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  RENAME_CONNECTION_COMMAND_TYPE,
  type RenameConnectionCommandData,
  CONNECTION_RENAMED_EVENT_TYPE,
  SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  type SelectMigrationRouteCommandData,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  type BeginMigrationFinalizationCommandData,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  FINALIZE_MIGRATION_COMMAND_TYPE,
  type FinalizeMigrationCommandData,
  MIGRATION_FINALIZED_EVENT_TYPE,
  qualifySsoDomainOwnership,
  SsoConnectionAlreadyRegisteredError,
  type RejectDomainClaimCommandData,
  type RequestTeardownCommandData,
  type RequestVerificationCommandData,
  type SetArrivalPolicyCommandData,
  type ResumeConnectionCommandData,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoConnectionActivationBlockedError,
  SsoConnectionInvalidTransitionError,
  SsoDomainProofExpiredError,
  verificationHasExpired,
  SsoConnectionTeardownStrandsUsersError,
  type SuspendConnectionCommandData,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
} from "@langwatch/identity-contract";

import { grandfatheredConnectionFacts } from "../rules/sso-connection-grandfather-facts.rules.ts";
import { activationRecoveryReservationId } from "../rules/sso-connection-id.rules.ts";
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

  private constructor(deps: SsoConnectionGuardsDeps) {
    this.checks = SsoConnectionGuardChecksService.create(deps);
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

  async claimDomain(data: ClaimDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, CLAIM_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    const alreadyClaimed = [
      state.claimedDomains,
      state.approvedDomains,
      state.verifiedDomains,
    ].some((domains) => domains.includes(domain));
    if (alreadyClaimed) {
      return [];
    }
    // Checked after the retry short-circuit, so a repeated claim never spends
    // the budget its first attempt already paid for.
    if (!isClaimableSsoDomain(domain)) {
      throw new SsoDomainNotEligibleError(
        `connection ${data.connectionId}: ${domain} is not a domain an organization can hold alone`,
      );
    }
    const retryAfterSeconds = domainClaimRetryAfterSeconds({
      claims: state.domainClaims,
      nowMs: data.occurredAtMs,
    });
    if (retryAfterSeconds > 0) {
      throw new SsoDomainClaimThrottledError(retryAfterSeconds);
    }

    return [
      {
        type: DOMAIN_CLAIMED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * Deciding a domain claim is a LangWatch operator's act, on every tier and every deployment.
   */
  async approveDomainClaim(data: ApproveDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, APPROVE_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.approvedDomains.includes(domain)) {
      return [];
    }

    // An operator's hand is what a command that says nothing means: the
    // published record is the newer authority, so it is the one that has to
    // name itself — and naming it here, without having read a record, is
    // exactly the move this refuses. Only `verifyDomain` states it.
    const authority = data.authority ?? "platform-operator";
    if (authority === "dns-proof") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: nothing may approve the claim on ${domain} on a published record's authority except the check that read the record`,
      );
    }
    await this.checks.assertPlatformOperator({
      actor: data.actor,
      act: `approve the claim on ${domain}`,
    });
    this.checks.assertClaimed({ state, domain });

    return [
      {
        type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          authority,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** The same decision with the opposite answer, so the same operator gate:
   *  a claim is decided by LangWatch or it is not decided. */
  async rejectDomainClaim(data: RejectDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, REJECT_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    await this.checks.assertPlatformOperator({
      actor: data.actor,
      act: `reject the claim on ${domain}`,
    });
    this.checks.assertClaimed({ state, domain });

    return [
      {
        type: DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          note: data.note,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  async discardConnection(data: DiscardConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    await this.checks.require(data, DISCARD_CONNECTION_COMMAND_TYPE);

    return [
      {
        type: CONNECTION_DISCARDED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The ceremony's opening move, and where first-verifier-owns is enforced.
   */
  async requestVerification(
    data: RequestVerificationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, REQUEST_VERIFICATION_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    // A record may be asked for against an approved claim, or against one
    // still waiting — the record is what will decide the waiting one. Only
    // the published-record ceremony may stand in for a decision.
    const decided = state.approvedDomains.includes(domain);
    const waiting = state.claimedDomains.includes(domain);
    if (!decided && !(waiting && data.method === "dns-txt")) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no claim a ${data.method} ceremony may prove`,
      );
    }
    await this.checks.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });

    return [
      {
        type: VERIFICATION_REQUESTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          method: data.method,
          tokenHash: data.tokenHash,
          expiresAtMs: data.expiresAtMs ?? null,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * A platform operator states out of band that the domain is that organization's (D05 tier 1 /
   * D04 amendment). One step, APPROVED straight to VERIFIED, because nothing is published and
   * so nothing is pending.
   */
  async attestDomain(data: AttestDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, ATTEST_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.verifiedDomains.includes(domain)) {
      return [];
    }

    await this.checks.assertPlatformOperator({
      actor: data.actor,
      act: `attest ${domain}`,
    });
    if (!state.approvedDomains.includes(domain)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no approved claim to attest`,
      );
    }

    await this.checks.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });

    return [
      {
        type: DOMAIN_ATTESTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          evidenceRef: data.evidenceRef,
          note: data.note,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * A domain taken back out — a mistyped claim, a domain the company let go.
   * Refused for a VERIFIED domain on a connection that is deciding sign-in:
   * that is a connection to remove, not a domain to tidy.
   */
  async withdrawDomain(data: WithdrawDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, WITHDRAW_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    const known =
      state.claimedDomains.includes(domain) ||
      state.approvedDomains.includes(domain) ||
      state.verifiedDomains.includes(domain) ||
      state.pendingVerification?.domain === domain;
    if (!known) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} is not on this connection`,
      );
    }

    const routing = state.state === "ACTIVE" || state.state === "SUSPENDED";
    if (routing && state.verifiedDomains.includes(domain)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: ${domain} is verified on a live connection; remove the connection instead`,
      );
    }

    return [
      {
        type: DOMAIN_WITHDRAWN_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The proof landed. Ownership is re-checked: the ceremony is not
   * instantaneous, and another organization's connection may have gone
   * ACTIVE on the same domain while this one was waiting for DNS.
   */
  async verifyDomain(data: VerifyDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, VERIFY_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.verifiedDomains.includes(domain)) {
      return [];
    }

    const pending = state.pendingVerification;
    if (!pending || pending.domain !== domain) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: no verification is in flight for ${domain}`,
      );
    }
    // A record found after its expiry proves nothing. Refused rather than
    // swept away, so asking again costs one click and no progress.
    if (verificationHasExpired({ pending, nowMs: data.occurredAtMs })) {
      throw new SsoDomainProofExpiredError(
        `connection ${data.connectionId}: the ceremony for ${domain} passed its expiry`,
      );
    }

    await this.checks.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });

    // Which channel the caller read the token from. Only a published-proof
    // ceremony has channels, so naming one against any other ceremony is a
    // caller confused about what it checked.
    if (data.channel !== undefined && pending.method !== "dns-txt") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: a ${pending.method} ceremony has no published channel to have read ${domain}'s proof from`,
      );
    }
    const method = data.channel ?? pending.method;
    // The record decides the claim: an undecided domain is approved by the
    // same act that proved it, and the approval says what authorized it.
    const undecided = state.claimedDomains.includes(domain);
    if (undecided && pending.method !== "dns-txt") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: a ${pending.method} ceremony cannot decide the claim on ${domain}`,
      );
    }

    return [
      ...(undecided
        ? [
            {
              type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
              data: {
                connectionId: data.connectionId,
                domain,
                actor: data.actor,
                authority: "dns-proof" as const,
                source: data.source,
              },
            },
          ]
        : []),
      {
        type: DOMAIN_VERIFIED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          method,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * Somebody decided who this connection admits (ADR-117 §3). Idempotent by
   * state: re-stating the policy the connection already has says nothing,
   * so a screen that saves twice does not claim two decisions.
   */
  async setArrivalPolicy(data: SetArrivalPolicyCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, SET_ARRIVAL_POLICY_COMMAND_TYPE);
    if (state.arrivalPolicy === data.policy && state.arrivalPolicyDecidedAtMs !== null) {
      return [];
    }

    return [
      {
        type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          policy: data.policy,
          actor: data.actor,
          source: "self-serve",
        },
      },
    ];
  }

  /**
   * A re-check found the record gone (ADR-123). The first absence starts the
   * clock; a later one lapses only once the deadline the customer was TOLD
   * has passed, and an already-lapsed domain states nothing.
   */
  async recordDomainProofAbsent(
    data: RecordDomainProofAbsentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    const proof = this.requirePublishedProof({ state, domain });
    if (proof.proofState === "LAPSED") {
      return [];
    }

    if (proof.proofState === "VERIFIED") {
      return [
        {
          type: DOMAIN_PROOF_WAVERED_EVENT_TYPE,
          data: {
            connectionId: data.connectionId,
            domain,
            firstAbsentAtMs: data.occurredAtMs,
            graceEndsAtMs: data.occurredAtMs + data.graceMs,
            actor: data.actor,
            source: data.source,
          },
        },
      ];
    }

    const firstAbsentAtMs = proof.firstAbsentAtMs ?? data.occurredAtMs;
    const deadline = proof.graceEndsAtMs ?? firstAbsentAtMs + data.graceMs;
    if (data.occurredAtMs < deadline) {
      return [];
    }

    return [
      {
        type: DOMAIN_PROOF_LAPSED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          firstAbsentAtMs,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * A re-check found the record published (ADR-123). Recovery is
   * unconditional and costs nothing beyond publishing it; a domain nothing
   * was doubting states nothing, which every healthy domain does.
   */
  async recordDomainProofPresent(
    data: RecordDomainProofPresentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    const proof = this.requirePublishedProof({ state, domain });
    if (proof.proofState === "VERIFIED") {
      return [];
    }

    return [
      {
        type: DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          absentForMs: Math.max(
            0,
            data.occurredAtMs - (proof.firstAbsentAtMs ?? data.occurredAtMs),
          ),
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The proof a published answer is entitled to speak about. Everything else
   * is refused rather than ignored, so a caller sweeping the wrong set of
   * domains is told rather than quietly lapsing evidence never in DNS.
   */
  private requirePublishedProof({
    state,
    domain,
  }: {
    state: SsoConnectionState;
    domain: string;
  }): SsoDomainVerification {
    const proof = state.domainVerifications.find((entry) => entry.domain === domain);
    if (!proof) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${state.connectionId}: ${domain} has no proof to re-check`,
      );
    }
    if (proof.method !== "dns-txt" && proof.method !== "https-file") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${state.connectionId}: ${domain} was proved by ${proof.method}, which no published proof can speak for`,
      );
    }

    return proof;
  }

  /**
   * Activation's three preconditions, checked together (ADR-117 §5):
   */
  async activateConnection(data: ActivateConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, ACTIVATE_CONNECTION_COMMAND_TYPE);
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
  async renameConnection(data: RenameConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, RENAME_CONNECTION_COMMAND_TYPE);
    const name = data.name.trim();
    if (state.idpMetadata.providerId === name) {
      return [];
    }

    return [
      {
        type: CONNECTION_RENAMED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          name,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The one direct replacement an organization may run beside its
   * grandfathered connection. The proofs that still qualify come with it, so
   * a customer never re-proves a domain they have already proved.
   */
  async registerReplacementConnection(
    data: RegisterReplacementConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const existing = await this.checks
      .getConnection({ connectionId: data.connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (existing) {
      // A retry of the same registration states nothing; an id held by
      // anything else is refused rather than moved.
      if (
        existing.organizationId === data.organizationId &&
        existing.replacesConnectionId === data.replacesConnectionId
      ) {
        return [];
      }

      throw new SsoConnectionAlreadyRegisteredError(
        `connection ${data.connectionId} is already registered`,
      );
    }

    const predecessor = await this.checks
      .getConnection({ connectionId: data.replacesConnectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (
      predecessor?.organizationId !== data.organizationId ||
      predecessor.source !== "legacy-grandfathered" ||
      predecessor.state !== "ACTIVE"
    ) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.replacesConnectionId} is not an active grandfathered connection for organization ${data.organizationId}`,
      );
    }
    await this.checks.refuseCompetingConnection({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      kind: "direct",
      allowedConnectionId: data.replacesConnectionId,
    });
    await this.checks.claimRegistrationSlot({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      commandId: data.commandId,
      kind: "direct",
      replacesConnectionId: data.replacesConnectionId,
    });

    return [
      {
        type: REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          type: data.type,
          idp: data.idp,
          arrivalPolicy: data.arrivalPolicy,
          replacesConnectionId: data.replacesConnectionId,
          inheritedDomainVerifications: predecessor.domainVerifications.filter(
            (proof) =>
              qualifySsoDomainOwnership({ state: predecessor, domain: proof.domain }).status ===
              "QUALIFIED",
          ),
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** Which of the pair decides an ordinary sign-in. Locked once finalization
   *  has started: past that point the legacy route is being dismantled. */
  async selectMigrationRoute(
    data: SelectMigrationRouteCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, SELECT_MIGRATION_ROUTE_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZING" || state.migrationPhase === "FINALIZED") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: migration route is locked in ${state.migrationPhase}`,
      );
    }
    const selected = data.route === "legacy" ? "GRACE_LEGACY" : "GRACE_DIRECT";
    if (state.migrationPhase === selected) {
      return [];
    }

    return [
      {
        type: MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          route: data.route,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** The durable gate: it lands BEFORE any account is removed, so a process
   *  that dies mid-retirement resumes instead of pretending it finished. */
  async beginMigrationFinalization(
    data: BeginMigrationFinalizationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZING") {
      return [];
    }
    if (state.migrationPhase !== "GRACE_DIRECT") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: finalization requires the direct migration route`,
      );
    }

    return [
      {
        type: MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  async finalizeMigration(data: FinalizeMigrationCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, FINALIZE_MIGRATION_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZED") {
      return [];
    }
    if (state.migrationPhase !== "FINALIZING") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: migration has not entered finalization`,
      );
    }

    return [
      {
        type: MIGRATION_FINALIZED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** A migration verb on a connection that replaces nothing is a mistake,
   *  not a step: it would write a phase onto a connection no pair contains. */
  private requireReplacementMigration(state: SsoConnectionState): void {
    if (state.replacesConnectionId === null || state.migrationPhase === null) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${state.connectionId} is not a legacy replacement`,
      );
    }
  }
}
