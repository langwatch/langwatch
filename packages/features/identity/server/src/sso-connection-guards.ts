import {
  ACTIVATE_CONNECTION_COMMAND_TYPE,
  type ActivateConnectionCommandData,
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  ATTEST_DOMAIN_COMMAND_TYPE,
  type AttestDomainCommandData,
  CLAIM_DOMAIN_COMMAND_TYPE,
  type ClaimDomainCommandData,
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
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  type GrandfatherConnectionCommandData,
  type IdentityActor,
  normalizeDomain,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  type RegisterConnectionCommandData,
  type RejectDomainClaimCommandData,
  type RequestTeardownCommandData,
  type RequestVerificationCommandData,
  type ResumeConnectionCommandData,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommandType,
  type SsoConnectionFactInput,
  type SsoConnectionLifecycleState,
  type SsoConnectionState,
  SsoConnectionActivationBlockedError,
  SsoConnectionDomainTakenError,
  SsoConnectionInvalidTransitionError,
  SsoConnectionOperatorActRequiredError,
  SsoConnectionTeardownStrandsUsersError,
  type SuspendConnectionCommandData,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
} from "@langwatch/identity-contract";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "./sso-connection.repository";

/**
 * The SSO connection guards (ADR-117 §5, D04): what runs BEFORE any fact
 * exists. Each verb reads the connection's FOLDED STATE, refuses what the
 * lifecycle forbids, and states only what the state does not already carry.
 *
 * One implementation, two callers — `SsoConnectionService` on the calling
 * path and the pipeline's command handlers on the staged re-run — so the
 * guard that vetoes a live command is the one the queue's re-run applies.
 * That is also what makes grandfathering safe: a grandfathered connection
 * gets its STATE from backfilled history, and every subsequent state CHANGE
 * arrives here and passes the same checks a self-served one does. There is
 * no grandfathered branch in this file, and that absence is the guarantee.
 *
 * Facts come back without their envelope; the ledger stamps business time,
 * tenancy and idempotency from the command that produced them.
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
  [REQUEST_VERIFICATION_COMMAND_TYPE]: ["APPROVED"],
  // Attestation replaces the PROOF, never the approval: it is commandable
  // from APPROVED and from nowhere else, which is what makes an attestation
  // against an unapproved claim a refusal rather than a shortcut.
  [ATTEST_DOMAIN_COMMAND_TYPE]: ["APPROVED"],
  [VERIFY_DOMAIN_COMMAND_TYPE]: ["VERIFICATION_PENDING"],
  [ACTIVATE_CONNECTION_COMMAND_TYPE]: ["VERIFIED"],
  [SUSPEND_CONNECTION_COMMAND_TYPE]: ["ACTIVE"],
  [RESUME_CONNECTION_COMMAND_TYPE]: ["SUSPENDED"],
  [REQUEST_TEARDOWN_COMMAND_TYPE]: ["ACTIVE", "SUSPENDED"],
  [COMPLETE_TEARDOWN_COMMAND_TYPE]: ["TEARDOWN_PENDING"],
};

export interface SsoConnectionGuardsDeps {
  connections: SsoConnectionReadRepository;
  breakGlass: SsoBreakGlassBindingRepository;
  stranding: SsoConnectionStrandingRepository;
  platformOperators: SsoPlatformOperatorRepository;
}

export class SsoConnectionGuards {
  private readonly connections: SsoConnectionReadRepository;
  private readonly breakGlass: SsoBreakGlassBindingRepository;
  private readonly stranding: SsoConnectionStrandingRepository;
  private readonly platformOperators: SsoPlatformOperatorRepository;

  constructor(deps: SsoConnectionGuardsDeps) {
    this.connections = deps.connections;
    this.breakGlass = deps.breakGlass;
    this.stranding = deps.stranding;
    this.platformOperators = deps.platformOperators;
  }

  async registerConnection(data: RegisterConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const existing = await this.connections.findConnection({
      connectionId: data.connectionId,
    });
    // The grandfather migration's whole idempotency rests on this line: a
    // second pass registers the same connection id and states nothing.
    if (existing) return [];
    return [
      {
        type: CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          type: data.type,
          idp: data.idp,
          allowsJit: data.allowsJit,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The legacy strings, stated as the history a connection would have had
   * (ADR-117 §5). It is the one verb that emits a whole lifecycle at once,
   * and the one that runs no lifecycle check — because it is not moving a
   * connection through the lifecycle, it is recording one that already
   * happened outside it.
   *
   * What keeps that from being a hole: it can only CREATE. A connection that
   * already exists gets nothing, so there is no reachable state in which this
   * command changes an existing connection, and every change to a
   * grandfathered connection afterwards goes through the guarded verbs above
   * like anyone else's.
   */
  async grandfatherConnection(
    data: GrandfatherConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const existing = await this.connections.findConnection({
      connectionId: data.connectionId,
    });
    if (existing) return [];

    const { connectionId, actor, source } = data;
    const domains = data.domains.map(normalizeDomain);
    return [
      {
        type: CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId,
          organizationId: data.organizationId,
          type: data.type,
          idp: data.idp,
          allowsJit: data.allowsJit,
          actor,
          source,
        },
      },
      ...domains.flatMap((domain: string): SsoConnectionFactInput[] => [
        {
          type: DOMAIN_CLAIMED_EVENT_TYPE,
          data: { connectionId, domain, actor, source },
        },
        {
          type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
          data: { connectionId, domain, actor, source },
        },
        {
          type: DOMAIN_VERIFIED_EVENT_TYPE,
          data: {
            connectionId,
            domain,
            method: "legacy-configuration",
            actor,
            source,
          },
        },
      ]),
      {
        type: CONNECTION_ACTIVATED_EVENT_TYPE,
        data: {
          connectionId,
          // The years of production sign-ins the strings already served are
          // the test login; naming a single account would be a fiction.
          testLoginAccountId: null,
          actor,
          source,
        },
      },
    ];
  }

  async claimDomain(data: ClaimDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, CLAIM_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (
      state.claimedDomains.includes(domain) ||
      state.approvedDomains.includes(domain) ||
      state.verifiedDomains.includes(domain)
    ) {
      return [];
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
   * Deciding a domain claim is a LangWatch operator's act, on every tier and
   * every deployment. It is the abuse boundary the whole design rests on:
   * first-verifier-owns means an approved claim is what lets a connection
   * take a domain, so an organization administrator approving their own would
   * make the queue a formality. Checked here rather than only on the surface,
   * so the rule holds for every caller the aggregate will ever have.
   */
  async approveDomainClaim(data: ApproveDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, APPROVE_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.approvedDomains.includes(domain)) return [];
    await this.requirePlatformOperator({
      actor: data.actor,
      act: `approve the claim on ${domain}`,
    });
    this.requireClaimed({ state, domain });
    return [
      {
        type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** The same decision with the opposite answer, so the same operator gate:
   *  a claim is decided by LangWatch or it is not decided. */
  async rejectDomainClaim(data: RejectDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, REJECT_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    await this.requirePlatformOperator({
      actor: data.actor,
      act: `reject the claim on ${domain}`,
    });
    this.requireClaimed({ state, domain });
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
    await this.require(data, DISCARD_CONNECTION_COMMAND_TYPE);
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
   * Checked here rather than at `verifyDomain` on purpose: refusing before
   * the operator publishes a TXT record costs them nothing, and refusing
   * after would mean telling them the record they just made is worthless.
   */
  async requestVerification(
    data: RequestVerificationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, REQUEST_VERIFICATION_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (!state.approvedDomains.includes(domain)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no approved claim to verify`,
      );
    }
    await this.refuseIfDomainOwnedElsewhere({
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
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * A platform operator states out of band that the domain is that
   * organization's (D05 tier 1 / D04 amendment). One step, APPROVED straight
   * to VERIFIED, because nothing is published and so nothing is pending.
   *
   * Three things this deliberately does NOT do:
   *
   * - It does not replace the approval. `ALLOWED_FROM` admits it from
   *   APPROVED alone, so an attestation against a claim nobody approved is
   *   refused and states no fact. The trust decision stays where it has
   *   always been, and an attested domain is exactly as trustworthy as that
   *   approval — no more.
   * - It does not relax first-verifier-owns. The identical ownership check
   *   the DNS ceremony runs runs here, so an operator cannot attest a domain
   *   another ACTIVE connection holds.
   * - It does not expire. Nothing here writes a deadline, and nothing
   *   elsewhere reads one: the answer to a disputed attestation is suspend,
   *   which is immediate, reversible, and taken by a human at the moment it
   *   matters.
   */
  async attestDomain(data: AttestDomainCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, ATTEST_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.verifiedDomains.includes(domain)) return [];
    await this.requirePlatformOperator({
      actor: data.actor,
      act: `attest ${domain}`,
    });
    if (!state.approvedDomains.includes(domain)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no approved claim to attest`,
      );
    }
    await this.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });
    return [
      {
        type: DOMAIN_ATTESTED_EVENT_TYPE,
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
    const state = await this.require(data, VERIFY_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.verifiedDomains.includes(domain)) return [];
    const pending = state.pendingVerification;
    if (!pending || pending.domain !== domain) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: no verification is in flight for ${domain}`,
      );
    }
    await this.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });
    return [
      {
        type: DOMAIN_VERIFIED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          method: pending.method,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * Activation's three preconditions, checked together (ADR-117 §5):
   * a verified domain, a live break-glass binding, and a recorded test
   * login. The break-glass one is the reason activation cannot lock an
   * organization out of its own instance — if the IdP is misconfigured,
   * somebody must still be able to get in and turn it off.
   */
  async activateConnection(data: ActivateConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, ACTIVATE_CONNECTION_COMMAND_TYPE);
    if (state.verifiedDomains.length === 0) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${data.connectionId}: no verified domain`,
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
    const bound = await this.breakGlass.hasLiveBinding({
      organizationId: state.organizationId,
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
    await this.require(data, SUSPEND_CONNECTION_COMMAND_TYPE);
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
    await this.require(data, RESUME_CONNECTION_COMMAND_TYPE);
    return [
      {
        type: CONNECTION_RESUMED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * Teardown never strands a user. The read is over the identity heads: a
   * user whose only live identifiers belong to this connection has no other
   * way in, and removing it would turn a configuration change into an
   * account loss. The refusal names how many, and heals itself the moment
   * those people hold another verified method.
   */
  async requestTeardown(data: RequestTeardownCommandData): Promise<SsoConnectionFactInput[]> {
    await this.require(data, REQUEST_TEARDOWN_COMMAND_TYPE);
    const stranded = await this.stranding.findStrandedUserIds({
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
   * The process manager's wake dispatches this once the grace has elapsed.
   * The deadline is re-read from the folded state rather than trusted from
   * the wake: a lagged wake, a replayed job or a hand-run command must not
   * be able to complete a teardown early.
   */
  async completeTeardown(data: CompleteTeardownCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, COMPLETE_TEARDOWN_COMMAND_TYPE);
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

  private async require(
    data: { connectionId: string },
    command: SsoConnectionCommandType,
  ): Promise<SsoConnectionState> {
    const state = await this.connections.findConnection({
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
   * The operator gate, asked of the port rather than of the command. The
   * refusal is the same whoever the actor is and whatever the deployment: an
   * organization administrator holding every permission their organization
   * can grant is still not a LangWatch operator, and a self-hosted
   * installation's platform operator still is one.
   */
  private async requirePlatformOperator({
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
    if (isOperator) return;
    throw new SsoConnectionOperatorActRequiredError(
      `actor ${actor.id} is not a platform operator and may not ${act}`,
    );
  }

  private requireClaimed({ state, domain }: { state: SsoConnectionState; domain: string }): void {
    if (state.claimedDomains.includes(domain)) return;
    throw new SsoConnectionInvalidTransitionError(
      `connection ${state.connectionId}: ${domain} has no claim awaiting a decision`,
    );
  }

  private async refuseIfDomainOwnedElsewhere({
    domain,
    connectionId,
  }: {
    domain: string;
    connectionId: string;
  }): Promise<void> {
    const owner = await this.connections.findDomainOwner({ domain });
    if (owner && owner.connectionId !== connectionId) {
      throw new SsoConnectionDomainTakenError(
        `domain ${domain} is already verified on connection ${owner.connectionId}`,
      );
    }
  }
}
