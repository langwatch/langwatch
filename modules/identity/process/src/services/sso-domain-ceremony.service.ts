import {
  normalizeDomain,
  SSO_DNS_PROOF_TTL_MS,
  type SelfServeActor,
  type SelfServeIssuedDnsRecord,
  SsoConnectionNotFoundError,
  type SsoConnectionState,
  SsoDomainClaimPendingError,
  SsoDomainLookupFailedError,
  SsoDomainProofNotFoundError,
  type SsoPublishedProofChannel,
  ssoDnsRecordName,
  ssoDomainRecordLocation,
  ssoVerificationFileUrl,
} from "@langwatch/identity-contract";

import type { SsoDomainProofFileChannel } from "../channels/sso-domain-proof-file.channel.ts";
import type { SsoDomainProofChannel } from "../channels/sso-domain-proof.channel.ts";
import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import { mintVerificationToken, safeEqual, sha256Hex } from "../rules/pkce.rules.ts";
import { newSsoConnectionCommandId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

export interface SsoDomainCeremonyServiceDeps {
  connections: () => SsoConnectionService;
  reads: SsoConnectionReadRepository;
  proofs: SsoDomainProofChannel;
  files: SsoDomainProofFileChannel;
  now?: () => number;
}

/** One domain, on one connection, at one administrator's hand. */
export interface SsoDomainProofCommand {
  organizationId: string;
  connectionId: string;
  domain: string;
  actor: SelfServeActor;
}

/** What a claim did: waiting for a person when somebody else proved it first. */
export interface SsoDomainClaimOutcome {
  waitsForReview: boolean;
  disputed: boolean;
}

/** A ceremony already closed, or the record still to publish. */
export type SsoDomainProofIssue =
  | { proved: true }
  | { proved: false; record: SelfServeIssuedDnsRecord };

/**
 * The domain ceremony an administrator runs themselves (ADR-123, D05 tier 3).
 * The guards decide alone; this service mints the token, reads what the
 * domain publishes and compares the two.
 */
export class SsoDomainCeremonyService {
  static create(deps: SsoDomainCeremonyServiceDeps): SsoDomainCeremonyService {
    return new SsoDomainCeremonyService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoDomainCeremonyServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Records a claim; only published proof can verify it. */
  async claimDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<SsoDomainClaimOutcome> {
    // The surface refuses a foreign connection with the same words the
    // aggregate does, so neither can become an existence oracle.
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().claimDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
    });
    const disputed = await this.isDisputed({ organizationId, domain });

    return { waitsForReview: disputed, disputed };
  }

  /**
   * Issues the record to publish, and returns its value ONCE: the fact keeps
   * only the hash, so a customer who loses the value asks for a fresh record
   * rather than reading an old one back out of us.
   */
  async proveDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<SsoDomainProofIssue> {
    await this.requireClaimProvable({ organizationId, connectionId, domain });

    const value = mintVerificationToken();
    const expiresAtMs = this.now() + SSO_DNS_PROOF_TTL_MS;
    await this.deps.connections().requestVerification({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
      method: "dns-txt",
      tokenHash: `sha256:${sha256Hex(value)}`,
      expiresAtMs,
    });

    // Answered against the NORMALIZED domain, because that is the name the
    // lookup will ask for: naming one place and reading another is a
    // ceremony that can never finish.
    return {
      proved: false,
      record: {
        ...ssoDomainRecordLocation({ domain: normalizeDomain(domain) }),
        value,
        expiresAtMs,
      },
    };
  }

  /**
   * A domain taken back out — a mistyped claim, a domain the company let go,
   * a verification nobody wants any more. The guards refuse removing a
   * VERIFIED domain from a connection that is deciding sign-in.
   */
  async removeDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: SsoDomainProofCommand): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().withdrawDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
    });
  }

  checkDomainRecord(command: SsoDomainProofCommand): Promise<{ proved: true }> {
    return this.checkPublishedProof(command, "dns-txt");
  }

  checkDomainFile(command: SsoDomainProofCommand): Promise<{ proved: true }> {
    return this.checkPublishedProof(command, "https-file");
  }

  private async checkPublishedProof(
    { organizationId, connectionId, domain, actor }: SsoDomainProofCommand,
    channel: SsoPublishedProofChannel,
  ): Promise<{ proved: true }> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    const normalized = normalizeDomain(domain);
    const pending = state.pendingVerification;
    if (!pending || pending.domain !== normalized) {
      throw new SsoDomainProofNotFoundError(
        `connection ${connectionId}: no record is outstanding for ${normalized}`,
      );
    }

    const { published, missingProof } = await this.publishedProofFor({
      connectionId,
      domain: normalized,
      channel,
    });

    // Neither a missing proof nor an unreachable publisher changes the ceremony.
    const matched = published.some((value) =>
      safeEqual(`sha256:${sha256Hex(value.trim())}`, pending.tokenHash),
    );
    if (!matched) throw missingProof;

    // The aggregate rechecks expiry and ownership before recording the proof.
    await this.deps.connections().verifyDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain: normalized,
      channel,
    });

    return { proved: true };
  }

  /** What the domain publishes, and the refusal that stands if none matches. */
  private async publishedProofFor({
    connectionId,
    domain,
    channel,
  }: {
    connectionId: string;
    domain: string;
    channel: SsoPublishedProofChannel;
  }): Promise<{ published: string[]; missingProof: Error }> {
    if (channel === "dns-txt") {
      const name = ssoDnsRecordName({ domain });
      const lookup = await this.deps.proofs.lookupTxtValues({ domain, name });
      if (lookup.outcome === "unreachable") {
        throw new SsoDomainLookupFailedError(
          `connection ${connectionId}: ${name} could not be resolved (${lookup.reason})`,
        );
      }

      return {
        published: lookup.outcome === "published" ? lookup.values : [],
        missingProof: new SsoDomainProofNotFoundError(
          `connection ${connectionId}: no matching record is published at ${name}`,
        ),
      };
    }

    const url = ssoVerificationFileUrl({ domain });
    const fetched = await this.deps.files.fetchVerificationFile({ domain, url });
    if (fetched.outcome === "unreachable") {
      throw new SsoDomainLookupFailedError(
        `connection ${connectionId}: ${url} could not be fetched (${fetched.reason})`,
      );
    }

    return {
      published: fetched.outcome === "served" ? fetched.values : [],
      missingProof: new SsoDomainProofNotFoundError(
        `connection ${connectionId}: no matching file is served at ${url}`,
      ),
    };
  }

  /** Avoid issuing proof for a waiting claim another organization proved
   *  first. The aggregate enforces ownership again when the proof arrives. */
  private async requireClaimProvable({
    organizationId,
    connectionId,
    domain,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
  }): Promise<void> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    if (!state.claimedDomains.includes(normalizeDomain(domain))) return;
    if (!(await this.isDisputed({ organizationId, domain }))) return;

    throw new SsoDomainClaimPendingError(
      `connection ${connectionId}: the claim on ${domain} has not been decided`,
    );
  }

  /** Uses the same deployment-scoped ownership read as the aggregate guards. */
  private async isDisputed({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<boolean> {
    const owner = await this.deps.reads.tryFindDomainOwner({
      domain: normalizeDomain(domain),
    });

    return owner !== null && owner.organizationId !== organizationId;
  }

  /** Missing and foreign connections share one refusal, so a caller cannot
   *  learn that a connection it may not read exists. */
  private async requireOrganizationConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionState> {
    const state = await this.deps.reads.tryFindConnection({ connectionId });
    if (!state || state.organizationId !== organizationId) {
      throw new SsoConnectionNotFoundError(`connection ${connectionId} does not exist`);
    }

    return state;
  }

  /** The identity block every command carries. Minted here so no caller can
   *  supply an actor: the administrator the surface authenticated is it. */
  private command({
    organizationId,
    connectionId,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
  }) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actor.userId },
      source: "self-serve" as const,
    };
  }
}
