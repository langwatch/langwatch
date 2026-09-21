import {
  normalizeDomain,
  SSO_DNS_REPROOF_GRACE_MS,
  type SsoConnectionFact,
  type SsoDomainReproofOutcome,
  ssoDnsRecordName,
  ssoVerificationFileUrl,
} from "@langwatch/identity-contract";

import type { SsoDomainProofFileChannel } from "../channels/sso-domain-proof-file.channel.ts";
import type { SsoDomainProofChannel } from "../channels/sso-domain-proof.channel.ts";
import type {
  SsoDomainReproofTarget,
  SsoDomainReproofTargetRepository,
} from "../repositories/sso-domain-reproof.repository.ts";
import { safeEqual, sha256Hex } from "../rules/pkce.rules.ts";
import { newSsoConnectionCommandId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

export interface SsoDomainReproofServiceDeps {
  connections: () => SsoConnectionService;
  targets: SsoDomainReproofTargetRepository;
  proofs: SsoDomainProofChannel;
  /** The file channel's re-read, for domains a served file proved. */
  files: SsoDomainProofFileChannel;
  /** How long a domain keeps vouching after its record goes missing. */
  graceMs?: number;
  now?: () => number;
}

/**
 * How many domains one sweep re-reads. A ceiling rather than a page: more
 * proved domains than this is a conversation about capacity, not a sweep
 * that silently skips half of them.
 */
export const SSO_DOMAIN_REPROOF_BATCH = 500;

/**
 * Re-reading the records that prove domains (ADR-123). A lookup that FAILED
 * commands nothing, a check that changes nothing states nothing, and only
 * published proofs are ever re-read — each structural, not a branch.
 */
export class SsoDomainReproofService {
  static create(deps: SsoDomainReproofServiceDeps): SsoDomainReproofService {
    return new SsoDomainReproofService(deps);
  }

  private readonly now: () => number;
  private readonly graceMs: number;

  private constructor(private readonly deps: SsoDomainReproofServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.graceMs = deps.graceMs ?? SSO_DNS_REPROOF_GRACE_MS;
  }

  /**
   * One sweep. Every domain is independent: a lookup that throws or a
   * command a guard refuses stops that domain and nothing else.
   */
  async sweep(): Promise<SsoDomainReproofOutcome> {
    const targets = await this.deps.targets.findDomainsProvedByRecord({
      limit: SSO_DOMAIN_REPROOF_BATCH,
    });
    const outcome: SsoDomainReproofOutcome = {
      truncated: targets.length >= SSO_DOMAIN_REPROOF_BATCH,
      checked: 0,
      wavered: 0,
      lapsed: 0,
      recovered: 0,
      unreachable: 0,
      failed: [],
    };
    for (const target of targets) {
      try {
        await this.reread({ target, outcome });
      } catch (error) {
        outcome.failed.push({ domain: target.domain, error });
      }
    }

    // Stamped for every target taken, the failures included: the question it
    // answers is "has the sweep looked at you", and one that threw must still
    // go to the back of the queue or it blocks everything behind it for ever.
    if (targets.length > 0) {
      await this.deps.targets.markSwept({
        connectionIds: [...new Set(targets.map((target) => target.connectionId))],
        atMs: this.now(),
      });
    }

    return outcome;
  }

  private async reread({
    target,
    outcome,
  }: {
    target: SsoDomainReproofTarget;
    outcome: SsoDomainReproofOutcome;
  }): Promise<void> {
    const domain = normalizeDomain(target.domain);
    const evidence = await this.lookupEvidence({ target, domain });
    outcome.checked += 1;
    if (evidence.outcome === "unreachable") {
      outcome.unreachable += 1;

      return;
    }

    const facts =
      evidence.outcome !== "absent" &&
      matchesToken({ tokenHash: target.tokenHash, values: evidence.values })
        ? await this.deps
            .connections()
            .recordDomainProofPresent({ ...this.command(target), domain })
        : await this.deps
            .connections()
            .recordDomainProofAbsent({ ...this.command(target), domain, graceMs: this.graceMs });

    count({ facts, outcome });
  }

  /** Where the evidence lives: a TXT name, or the well-known address. */
  private async lookupEvidence({
    target,
    domain,
  }: {
    target: SsoDomainReproofTarget;
    domain: string;
  }) {
    return target.method === "https-file"
      ? this.deps.files.fetchVerificationFile({ domain, url: ssoVerificationFileUrl({ domain }) })
      : this.deps.proofs.lookupTxtValues({ domain, name: ssoDnsRecordName({ domain }) });
  }

  /**
   * The identity block a sweep's command carries. The actor is the SYSTEM,
   * and a fresh command id per check, because two checks a day apart are two
   * observations and must not dedupe into one.
   */
  private command(target: SsoDomainReproofTarget) {
    return {
      tenantId: target.organizationId,
      organizationId: target.organizationId,
      connectionId: target.connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "system" as const, id: null },
      source: "self-serve" as const,
    };
  }
}

/** What the facts this check stated mean for the sweep's own tally. */
function count({
  facts,
  outcome,
}: {
  facts: SsoConnectionFact[];
  outcome: SsoDomainReproofOutcome;
}): void {
  for (const fact of facts) {
    if (fact.type === "lw.identity.domain_proof_wavered") outcome.wavered += 1;
    if (fact.type === "lw.identity.domain_proof_lapsed") outcome.lapsed += 1;
    if (fact.type === "lw.identity.domain_proof_recovered") outcome.recovered += 1;
  }
}

/**
 * Whether one published value is the token this domain was proved with.
 * Compared in constant time against the HASH the ceremony recorded: the
 * token is not public until the customer publishes it.
 */
function matchesToken({ tokenHash, values }: { tokenHash: string; values: string[] }): boolean {
  return values.some((value) => safeEqual(`sha256:${sha256Hex(value.trim())}`, tokenHash));
}
