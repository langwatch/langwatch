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
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  domainClaimFor,
  domainClaimRetryAfterSeconds,
  domainProofFor,
  GRANDFATHER_CONNECTION_COMMAND_TYPE,
  type GrandfatherConnectionCommandData,
  type IdentityActor,
  isClaimableSsoDomain,
  normalizeDomain,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  type RecordDomainProofAbsentCommandData,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  type RecordDomainProofPresentCommandData,
  REGISTER_CONNECTION_COMMAND_TYPE,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  REQUEST_TEARDOWN_COMMAND_TYPE,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  RESUME_CONNECTION_COMMAND_TYPE,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  type SetArrivalPolicyCommandData,
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
  type SsoDomainClaimAuthority,
  type SsoDomainVerification,
  SsoConnectionActivationBlockedError,
  SsoConnectionDomainTakenError,
  SsoConnectionInvalidTransitionError,
  SsoConnectionOperatorActRequiredError,
  SsoConnectionTeardownStrandsUsersError,
  SsoDomainClaimThrottledError,
  SsoDomainNotEligibleError,
  SsoDomainProofExpiredError,
  SsoLicenseRequiredError,
  verificationHasExpired,
  type SuspendConnectionCommandData,
  TEARDOWN_REQUESTED_EVENT_TYPE,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  type WithdrawDomainCommandData,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
} from "@langwatch/identity";
import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoLicenseAuthorityRepository,
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
const ALLOWED_FROM: Record<
  SsoConnectionCommandType,
  readonly SsoConnectionLifecycleState[]
> = {
  [REGISTER_CONNECTION_COMMAND_TYPE]: [],
  [GRANDFATHER_CONNECTION_COMMAND_TYPE]: [],
  [CLAIM_DOMAIN_COMMAND_TYPE]: ["DRAFT", "REJECTED", "VERIFIED", "ACTIVE"],
  [APPROVE_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED"],
  [REJECT_DOMAIN_CLAIM_COMMAND_TYPE]: ["CLAIMED"],
  // Every pre-live state, because "start over" is a self-serve act: nothing
  // routes before ACTIVE, so a discard strands nobody however far the
  // journey got. A LIVE connection leaves through teardown, which is graced
  // and strand-checked, never through a discard.
  [DISCARD_CONNECTION_COMMAND_TYPE]: [
    "DRAFT",
    "CLAIMED",
    "APPROVED",
    "VERIFICATION_PENDING",
    "REJECTED",
    "VERIFIED",
  ],
  // Any state where a domain can exist. The verb's own guard narrows this
  // further: a VERIFIED domain on a routing connection is refused there.
  [WITHDRAW_DOMAIN_COMMAND_TYPE]: [
    "CLAIMED",
    "APPROVED",
    "VERIFICATION_PENDING",
    "REJECTED",
    "VERIFIED",
    "ACTIVE",
    "SUSPENDED",
  ],
  // From CLAIMED, because the published record is what DECIDES a claim: a
  // customer is given the record the moment they claim, and the proof
  // landing states the approval and the verification together. From
  // APPROVED for the tiers a licence or an operator already decided, and
  // from VERIFICATION_PENDING so a customer whose record expired can ask for
  // a fresh one. A re-request costs no progress either way.
  [REQUEST_VERIFICATION_COMMAND_TYPE]: [
    "CLAIMED",
    "APPROVED",
    "VERIFICATION_PENDING",
  ],
  // Attestation replaces the PROOF, never the approval: it is commandable
  // from APPROVED and from nowhere else, which is what makes an attestation
  // against an unapproved claim a refusal rather than a shortcut.
  [ATTEST_DOMAIN_COMMAND_TYPE]: ["APPROVED"],
  [VERIFY_DOMAIN_COMMAND_TYPE]: ["VERIFICATION_PENDING"],
  // Re-checking is for a connection whose domains are actually doing
  // something: one that reached VERIFIED and one serving traffic. A
  // SUSPENDED connection routes nothing, so doubting its evidence would
  // produce alerts about a door nobody can open, and a TEARDOWN_PENDING one
  // is on its way out.
  [RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE]: ["VERIFIED", "ACTIVE"],
  [RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE]: ["VERIFIED", "ACTIVE"],
  [ACTIVATE_CONNECTION_COMMAND_TYPE]: ["VERIFIED"],
  [SUSPEND_CONNECTION_COMMAND_TYPE]: ["ACTIVE"],
  [RESUME_CONNECTION_COMMAND_TYPE]: ["SUSPENDED"],
  // TEARDOWN_PENDING too: asking again for a removal already scheduled is
  // not a new removal, it re-derives the deadline — which is how an
  // organization that stopped routing off the connection brings the date
  // forward instead of waiting out a grace that protects nobody. The
  // stranded-users check runs again on the way through, so the re-ask can
  // never complete a teardown the first ask would have refused.
  [REQUEST_TEARDOWN_COMMAND_TYPE]: ["ACTIVE", "SUSPENDED", "TEARDOWN_PENDING"],
  [COMPLETE_TEARDOWN_COMMAND_TYPE]: ["TEARDOWN_PENDING"],
  // From VERIFIED, because "anybody on a domain you proved" is not an answer
  // anybody can give before there is one — the journey asks it at the step
  // after the proof lands. And from every state the connection can rest in
  // afterwards, because who a live connection admits is a decision an
  // organization revisits without re-registering anything. Not from
  // TEARDOWN_PENDING: a connection on its way out admits nobody, and saying
  // otherwise would be a setting that does nothing.
  [SET_ARRIVAL_POLICY_COMMAND_TYPE]: ["VERIFIED", "ACTIVE", "SUSPENDED"],
};

export interface SsoConnectionGuardsDeps {
  connections: SsoConnectionReadRepository;
  breakGlass: SsoBreakGlassBindingRepository;
  stranding: SsoConnectionStrandingRepository;
  platformOperators: SsoPlatformOperatorRepository;
  /** What the installation's licence may authorize (D05 tier 2). */
  licenseAuthority: SsoLicenseAuthorityRepository;
}

export class SsoConnectionGuards {
  private readonly connections: SsoConnectionReadRepository;
  private readonly breakGlass: SsoBreakGlassBindingRepository;
  private readonly stranding: SsoConnectionStrandingRepository;
  private readonly platformOperators: SsoPlatformOperatorRepository;
  private readonly licenseAuthority: SsoLicenseAuthorityRepository;

  constructor(deps: SsoConnectionGuardsDeps) {
    this.connections = deps.connections;
    this.breakGlass = deps.breakGlass;
    this.stranding = deps.stranding;
    this.platformOperators = deps.platformOperators;
    this.licenseAuthority = deps.licenseAuthority;
  }

  async registerConnection(
    data: RegisterConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
          // The migration states history rather than deciding anything, and
          // the history it states is one an operator configured by hand.
          data: {
            connectionId,
            domain,
            actor,
            authority: "platform-operator",
            source,
          },
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

  /**
   * Claim a domain — and the two rails that replaced a reviewer's eye.
   *
   * Both run HERE rather than only on the setup surface, because the
   * published record now decides the claim: there is no longer a person
   * between a claim and a domain routing sign-ins, so the things that person
   * would have noticed have to be rules. A domain nobody may own alone is
   * refused by name; more domains in the window than the connection is
   * allowed is refused by name with the wait attached.
   *
   * They are checked AFTER the already-claimed short-circuit above them, so
   * a retry of a claim that already exists still states nothing and still
   * costs nothing — a repeated command must not be able to spend the budget
   * its own first attempt already paid for.
   */
  async claimDomain(
    data: ClaimDomainCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, CLAIM_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (
      state.claimedDomains.includes(domain) ||
      state.approvedDomains.includes(domain) ||
      state.verifiedDomains.includes(domain)
    ) {
      return [];
    }
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
   * Deciding a domain claim is a LangWatch operator's act, on every tier and
   * every deployment. It is the abuse boundary the whole design rests on:
   * first-verifier-owns means an approved claim is what lets a connection
   * take a domain, so an organization administrator approving their own would
   * make the queue a formality. Checked here rather than only on the surface,
   * so the rule holds for every caller the aggregate will ever have.
   */
  async approveDomainClaim(
    data: ApproveDomainClaimCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, APPROVE_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.approvedDomains.includes(domain)) return [];
    // An operator's hand is what a command that says nothing means: the
    // licence path is the newer one, so it is the one that has to name
    // itself, and a caller written before tier 2 cannot accidentally claim
    // an authority it never had.
    const authority = data.authority ?? "platform-operator";
    await this.requireClaimAuthority({
      authority,
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
          authority,
          source: data.source,
        },
      },
    ];
  }

  /** The same decision with the opposite answer, so the same operator gate:
   *  a claim is decided by LangWatch or it is not decided. */
  async rejectDomainClaim(
    data: RejectDomainClaimCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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

  async discardConnection(
    data: DiscardConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
    // A record may be asked for against an approved claim, or against one
    // still waiting — the record is what will decide the waiting one. Only
    // the PUBLISHED-record ceremony may stand in for a decision: a licence
    // speaks for an installation and has already decided at the claim, so
    // asking for it here against an undecided claim would be a second,
    // unwitnessed way to approve one.
    const decided = state.approvedDomains.includes(domain);
    const waiting = domainClaimFor({ state, domain })?.state === "WAITING";
    if (!decided && !(waiting && data.method === "dns-txt")) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no claim a ${data.method} ceremony may prove`,
      );
    }
    // The licence-bound ceremony exists because a self-hosted customer has
    // nobody to publish a record for. Asked of the port rather than of the
    // command, so a hosted organization naming the method gets the same
    // refusal an unlicensed installation does, and neither of them can talk
    // its way past a DNS record it simply has to publish.
    if (data.method === "license-token") {
      const licensed =
        await this.licenseAuthority.licenseAuthorizesDomainClaims();
      if (!licensed) {
        throw new SsoLicenseRequiredError(
          `connection ${data.connectionId}: the licence-bound ceremony is not available on this deployment`,
        );
      }
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
          expiresAtMs: data.expiresAtMs ?? null,
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
  /**
   * Take a domain back out. Two refusals, and both are the caller's next
   * step rather than a dead end: a domain nothing in the state knows is an
   * invalid transition (nothing to withdraw), and a VERIFIED domain on a
   * connection that decides sign-in must leave through teardown — graced and
   * strand-checked — never by tidying the list out from under the people
   * routing through it.
   */
  async withdrawDomain(
    data: WithdrawDomainCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, WITHDRAW_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    const known =
      state.claimedDomains.includes(domain) ||
      state.approvedDomains.includes(domain) ||
      state.verifiedDomains.includes(domain) ||
      state.pendingVerification?.domain === domain ||
      state.domainClaims.some((claim) => claim.domain === domain);
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

  async attestDomain(
    data: AttestDomainCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
   * The proof landed — and, where the claim was still waiting, the proof IS
   * the decision.
   *
   * Two facts from one command in that case, approval first: a published
   * record is the strongest evidence anybody can hand us, so it authorizes
   * the claim under `dns-proof` and proves the domain in the same commit.
   * The ORDER is the honesty — a history can never say a domain was approved
   * before anything proved it — and one commit is what makes the pair
   * atomic, so no reachable state has an approval standing on a proof that
   * did not land.
   *
   * `dns-proof` is stated HERE and nowhere else. `approveDomainClaim` refuses
   * a caller that names it, so the only way that authority reaches a fact is
   * through this method, on a ceremony this method has just checked.
   *
   * Ownership is re-checked either way: the ceremony is not instantaneous,
   * and another organization's connection may have gone ACTIVE on the same
   * domain while this one was waiting for DNS. That refusal is what keeps a
   * dispute out of the self-deciding path.
   */
  async verifyDomain(
    data: VerifyDomainCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, VERIFY_DOMAIN_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.verifiedDomains.includes(domain)) return [];
    const pending = state.pendingVerification;
    if (!pending || pending.domain !== domain) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: no verification is in flight for ${domain}`,
      );
    }
    // A record found after its expiry proves nothing. Refused here rather
    // than swept away, so the record the customer was given is still on
    // screen and asking again is one click that costs no progress.
    if (verificationHasExpired({ pending, nowMs: data.occurredAtMs })) {
      throw new SsoDomainProofExpiredError(
        `connection ${data.connectionId}: the ceremony for ${domain} passed its expiry`,
      );
    }
    await this.refuseIfDomainOwnedElsewhere({
      domain,
      connectionId: data.connectionId,
    });
    // Which channel the caller's check actually read the token from. Only a
    // published-proof ceremony has channels — one minted token, satisfiable
    // as a TXT record or as the well-known file — so naming one against a
    // licence ceremony is a caller confused about what it checked.
    if (data.channel !== undefined && pending.method !== "dns-txt") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: a ${pending.method} ceremony has no published channel to have read ${domain}'s proof from`,
      );
    }
    const method = data.channel ?? pending.method;
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
            } satisfies SsoConnectionFactInput,
          ]
        : []),
      {
        type: DOMAIN_VERIFIED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          domain,
          // The channel that actually proved it, where the caller named one:
          // the re-proof sweep re-reads the evidence where the fact says it
          // lives, so a file-proved domain must never be recorded as a TXT
          // record somebody will later find absent.
          method,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * A re-check found no matching record on the domain (ADR-123).
   *
   * Three answers, and which one is a function of where the proof already
   * stood: evidence that was fine starts wavering, evidence that has been
   * missing past its deadline lapses, and evidence that is missing but still
   * inside its window states NOTHING. That last one is why re-checking every
   * few hours does not fill a customer's history with noise — a fact is
   * written when the world CHANGED, not when we looked.
   *
   * What this refuses outright is doubting a proof a published record never
   * made. An attested domain, a licence-bound one and a grandfathered one
   * have no TXT record to be missing, so a DNS answer says nothing about
   * them; without this, the sweep would find `absent` for every one of them
   * and lapse domains whose evidence was never in DNS at all.
   */
  async recordDomainProofAbsent(
    data: RecordDomainProofAbsentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(
      data,
      RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
    );
    const domain = normalizeDomain(data.domain);
    const proof = this.requirePublishedRecordProof({ state, domain });
    // Already lapsed: the record is still missing and that is already what
    // the connection says. Nothing changed, so nothing is stated.
    if (proof.proofState === "LAPSED") return [];
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
    // Wavering. The deadline is the one written on the wavering fact, not one
    // recomputed now: a customer keeps the deadline they were told, even if
    // the composed grace changed underneath them since.
    const firstAbsentAtMs = proof.firstAbsentAtMs ?? data.occurredAtMs;
    const deadline = proof.graceEndsAtMs ?? firstAbsentAtMs + data.graceMs;
    if (data.occurredAtMs < deadline) return [];
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
   * A re-check found the record published (ADR-123).
   *
   * Recovery is unconditional and costs the customer nothing beyond
   * publishing: no re-claim, no fresh token, no queue. A domain that was
   * never doubted states nothing, which is the steady state of every healthy
   * domain on every sweep.
   */
  async recordDomainProofPresent(
    data: RecordDomainProofPresentCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(
      data,
      RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
    );
    const domain = normalizeDomain(data.domain);
    const proof = this.requirePublishedRecordProof({ state, domain });
    if (proof.proofState === "VERIFIED") return [];
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
   * The proof a DNS answer is entitled to speak about: one a published record
   * made. Everything else is refused rather than ignored, so a caller that
   * sweeps the wrong set of domains is told, rather than quietly lapsing
   * evidence that was never in DNS.
   */
  private requirePublishedRecordProof({
    state,
    domain,
  }: {
    state: SsoConnectionState;
    domain: string;
  }): SsoDomainVerification {
    const proof = domainProofFor({ state, domain });
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
   * a verified domain, a live break-glass binding, and a recorded test
   * login. The break-glass one is the reason activation cannot lock an
   * organization out of its own instance — if the IdP is misconfigured,
   * somebody must still be able to get in and turn it off.
   */
  async activateConnection(
    data: ActivateConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
  async suspendConnection(
    data: SuspendConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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

  /**
   * Who this connection admits, stated (ADR-117 §3).
   *
   * NO PRECONDITION BEYOND THE STATE, and deliberately none about domains:
   * `admit` is bounded by routing, not by this verb. An address only ever
   * reaches a connection whose domain that connection PROVED, so "anybody
   * who reaches this" already means "anybody on a domain you proved". A
   * second check here would be the same rule enforced twice, in a place that
   * could drift from the one that actually decides.
   *
   * Restating a policy somebody already SAID costs no event, so a screen that
   * saves without changing anything writes no history. Saying one where
   * nobody has always writes, even where the answer matches the one the
   * connection was already behaving as: the fact IS somebody having decided,
   * and going live rests on that rather than on the behaviour. A connection
   * that turns arrivals away because nobody was asked and one that turns them
   * away because an administrator chose to are the same behaviour and very
   * different states, and only one of them is ready to be switched on.
   */
  async setArrivalPolicy(
    data: SetArrivalPolicyCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.require(data, SET_ARRIVAL_POLICY_COMMAND_TYPE);
    if (state.arrivalPolicy === data.policy) return [];
    return [
      {
        type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          policy: data.policy,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  async resumeConnection(
    data: ResumeConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
  async requestTeardown(
    data: RequestTeardownCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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
  async completeTeardown(
    data: CompleteTeardownCommandData,
  ): Promise<SsoConnectionFactInput[]> {
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

  /**
   * Who may decide a domain claim, on the authority the command names.
   *
   * Two answers a caller may ask for, and both are asked of a port: an
   * operator's hand, or the installation's licence. What makes the second
   * safe is that the licence speaks for an INSTALLATION rather than for
   * whoever is asking, so an organization administrator on the hosted service
   * naming it is refused by a port that answers no to every organization
   * there.
   *
   * `dns-proof` is the third authority and is NOT one of them. A caller
   * naming it would be asserting a published record nobody read; the only
   * thing that may state it is `verifyDomain`, in the same commit as the
   * proof it rests on, which is why naming it here is refused outright.
   */
  private async requireClaimAuthority({
    authority,
    actor,
    act,
  }: {
    authority: SsoDomainClaimAuthority;
    actor: IdentityActor;
    act: string;
  }): Promise<void> {
    if (authority === "dns-proof") {
      throw new SsoConnectionInvalidTransitionError(
        `nothing may ${act} on a published record's authority except the check that read the record`,
      );
    }
    if (authority === "platform-operator") {
      await this.requirePlatformOperator({ actor, act });
      return;
    }
    const licensed = await this.licenseAuthority.licenseAuthorizesDomainClaims();
    if (licensed) return;
    throw new SsoLicenseRequiredError(
      `no licence on this deployment authorizes ${act}`,
    );
  }

  private requireClaimed({
    state,
    domain,
  }: {
    state: SsoConnectionState;
    domain: string;
  }): void {
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
