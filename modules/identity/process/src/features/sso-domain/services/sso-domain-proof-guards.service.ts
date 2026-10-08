import {
  ATTEST_DOMAIN_COMMAND_TYPE,
  WITHDRAW_DOMAIN_COMMAND_TYPE,
  type AttestDomainCommandData,
  type WithdrawDomainCommandData,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_WITHDRAWN_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_RECOVERED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  normalizeDomain,
  RECORD_DOMAIN_PROOF_ABSENT_COMMAND_TYPE,
  RECORD_DOMAIN_PROOF_PRESENT_COMMAND_TYPE,
  type RecordDomainProofAbsentCommandData,
  type RecordDomainProofPresentCommandData,
  REQUEST_VERIFICATION_COMMAND_TYPE,
  type RequestVerificationCommandData,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  type SsoDomainVerification,
  SsoConnectionInvalidTransitionError,
  SsoDomainProofExpiredError,
  SsoDomainProofNotFoundError,
  verificationHasExpired,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  VERIFY_DOMAIN_COMMAND_TYPE,
  type VerifyDomainCommandData,
} from "@langwatch/identity-contract";

import type { SsoConnectionGuardChecksService } from "../../sso-connection/services/sso-connection-guard-checks.service.ts";

/** The domain-proof guards: verification, attestation and proof lapse. */
export class SsoDomainProofGuardsService {
  static create({
    checks,
  }: {
    checks: SsoConnectionGuardChecksService;
  }): SsoDomainProofGuardsService {
    return new SsoDomainProofGuardsService(checks);
  }

  private readonly checks: SsoConnectionGuardChecksService;

  private constructor(checks: SsoConnectionGuardChecksService) {
    this.checks = checks;
  }

  /**
   * The ceremony's opening move, and where first-verifier-owns is enforced.
   */
  async requestVerification(
    data: RequestVerificationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, REQUEST_VERIFICATION_COMMAND_TYPE);
    const domain = normalizeDomain(data.domain);
    // A proof may be asked for against an approved claim, or against one still
    // waiting: the published record, or on a self-hosted installation the
    // licence, decides the waiting one when it lands.
    const decided = state.approvedDomains.includes(domain);
    const waiting = state.claimedDomains.includes(domain);
    if (!decided && !waiting) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: domain ${domain} has no claim a ${data.method} ceremony may prove`,
      );
    }
    // Asked of the port rather than the command, so a hosted organization naming the
    // licence gets the refusal an unlicensed installation does.
    if (data.method === "license-token") {
      const licence = await this.checks.getLicenseAuthority();
      if (!licence.authorizesDomainClaims) {
        throw new SsoDomainProofNotFoundError(
          `connection ${data.connectionId}: no license on this deployment proves ${domain}; publish the DNS record or file`,
        );
      }
      await this.checks.assertLicenseSpeaksFor({
        licence,
        actor: data.actor,
        act: `prove ${domain} with the installation's license`,
      });
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
    // The proof decides the claim: an undecided domain is approved by the
    // same act that proved it, and the approval says what authorized it.
    const undecided = state.claimedDomains.includes(domain);
    const authority = await this.authorityDecidingClaim({
      data,
      domain,
      ceremony: pending.method,
      undecided,
    });

    return [
      ...(undecided
        ? [
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
   * Which authority a landing ceremony decides a waiting claim under: a published
   * record, or a self-hosted installation's licence, asked again at the moment it
   * decides rather than trusted from the request.
   */
  private async authorityDecidingClaim({
    data,
    domain,
    ceremony,
    undecided,
  }: {
    data: VerifyDomainCommandData;
    domain: string;
    ceremony: string;
    undecided: boolean;
  }): Promise<"license" | "dns-proof"> {
    if (ceremony === "license-token") {
      if (undecided) {
        await this.checks.assertClaimAuthority({
          authority: "license",
          actor: data.actor,
          act: `approve the claim on ${domain}`,
        });
      }
      return "license";
    }
    if (undecided && ceremony !== "dns-txt") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: a ${ceremony} ceremony cannot decide the claim on ${domain}`,
      );
    }
    return "dns-proof";
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
}
