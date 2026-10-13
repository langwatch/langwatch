import {
  APPROVE_DOMAIN_CLAIM_COMMAND_TYPE,
  type ApproveDomainClaimCommandData,
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  CLAIM_DOMAIN_COMMAND_TYPE,
  type ClaimDomainCommandData,
  domainClaimRetryAfterSeconds,
  isClaimableSsoDomain,
  SsoDomainClaimThrottledError,
  SsoDomainNotEligibleError,
  CONNECTION_DISCARDED_EVENT_TYPE,
  DISCARD_CONNECTION_COMMAND_TYPE,
  type DiscardConnectionCommandData,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  normalizeDomain,
  REJECT_DOMAIN_CLAIM_COMMAND_TYPE,
  SET_ARRIVAL_POLICY_COMMAND_TYPE,
  type RejectDomainClaimCommandData,
  type SetArrivalPolicyCommandData,
  type SsoConnectionFactInput,
} from "@langwatch/identity-contract";

import type { SsoConnectionGuardChecksService } from "../../sso-connection/services/sso-connection-guard-checks.service.ts";

/** The domain-claim guards: claim, approve, reject, discard and arrival policy. */
export class SsoDomainClaimGuardsService {
  static create({
    checks,
  }: {
    checks: SsoConnectionGuardChecksService;
  }): SsoDomainClaimGuardsService {
    return new SsoDomainClaimGuardsService(checks);
  }

  private readonly checks: SsoConnectionGuardChecksService;

  private constructor(checks: SsoConnectionGuardChecksService) {
    this.checks = checks;
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
   * Deciding a domain claim is a LangWatch operator's act, or on a self-hosted
   * installation its licence's; a published record decides only through `verifyDomain`.
   */
  async approveDomainClaim(data: ApproveDomainClaimCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, APPROVE_DOMAIN_CLAIM_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    if (state.approvedDomains.includes(domain)) {
      return [];
    }

    // An operator's hand is what a command that says nothing means: the newer
    // authorities have to name themselves.
    const authority = data.authority ?? "platform-operator";
    await this.checks.assertClaimAuthority({
      authority,
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
}
