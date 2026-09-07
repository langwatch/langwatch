import {
  normalizeDomain,
  SSO_DNS_REPROOF_GRACE_MS,
  ssoDnsRecordName,
  type SsoPublishedProofChannel,
  ssoVerificationFileUrl,
} from "@langwatch/identity";
import { safeEqual, sha256Hex } from "./crypto/pkce";
import { newSsoConnectionCommandId } from "./sso-connection-id";
import type { SsoConnectionService } from "./sso-connection.service";
import type {
  SsoDomainFileLookup,
  SsoDomainProofLookup,
} from "./sso-self-serve.service";

/**
 * Re-reading the records that prove domains (ADR-123).
 *
 * A published record is only evidence while it is published. Until this
 * existed, a domain proved once was proved forever: an administrator who
 * deleted the record in a spring clean, and a company that let a domain go
 * entirely, both kept vouching for whoever asked. This is the sweep that
 * notices, and the whole of what it does is turn three DNS outcomes into at
 * most one command per domain.
 *
 * Three properties are the point, and each is structural rather than a branch
 * somebody could later delete:
 *
 * - A LOOKUP THAT FAILED COMMANDS NOTHING. `unreachable` has no verb. A
 *   resolver of ours that times out has said nothing about the customer's
 *   DNS, so it cannot start a waver and cannot advance one toward a lapse.
 *   An outage of ours never spends a customer's grace.
 * - A CHECK THAT CHANGES NOTHING STATES NOTHING. Every command goes through
 *   the guards, which answer no facts when the world already says what the
 *   check found. Sweeping every few hours therefore costs a healthy
 *   connection exactly zero events, forever.
 * - ONLY PUBLISHED PROOFS ARE RE-READ. A domain an operator attested, a
 *   licence proved or the grandfather migration carried over has no record
 *   and no file to be missing, so it is never asked about — and the guard
 *   refuses the command anyway if a caller gets that wrong. The two
 *   published channels are each re-read where their evidence lives: a
 *   record-proved domain's TXT name, a file-proved domain's well-known
 *   address.
 */

/** One domain to re-read, and the connection whose history will carry the
 *  answer. */
export interface SsoDomainReproofTarget {
  connectionId: string;
  organizationId: string;
  domain: string;
  /** `sha256:…` of the token that proved this domain. The sweep compares
   *  against it, which is what makes a re-read verification rather than "is
   *  anything at all published at our name". */
  tokenHash: string;
  /**
   * Which channel proved the domain — the verified fact's own answer — and
   * therefore where the sweep re-reads: a record-proved domain's TXT name,
   * a file-proved domain's well-known address. Asking DNS about a domain
   * whose evidence is a file would find nothing and lapse it.
   */
  method: SsoPublishedProofChannel;
}

/**
 * Which domains are due a re-read. Cross-organization by nature — the sweep
 * is the platform's, not a tenant's — and deliberately unfiltered by "when
 * did we last look": nothing records that, because recording it would mean a
 * fact per check, which is the noise this design exists to avoid. Every due
 * domain is re-read every cycle, which at this size is one indexed query and
 * a bounded set of lookups.
 */
export interface SsoDomainReproofTargetRepository {
  findDomainsProvedByRecord(args: {
    limit: number;
  }): Promise<SsoDomainReproofTarget[]>;
  /**
   * Record that the sweep has LOOKED at these connections, whatever it found.
   *
   * Ordering the sweep by anything the re-read writes cannot work: a healthy
   * re-read writes nothing, so the same prefix is read forever — and a domain
   * that starts wavering DOES write, which sorted the one domain in its grace
   * window out of the batch and left it never to lapse. The look is its own
   * fact, and this is what makes the sweep round-robin.
   */
  markSwept(args: {
    connectionIds: readonly string[];
    atMs: number;
  }): Promise<void>;
}

/** Who is told the evidence behind their domain is going, and then gone. */
export interface SsoDomainReproofNotifier {
  /** The record has just gone missing, and there is still time. */
  wavering(args: {
    connectionId: string;
    organizationId: string;
    domain: string;
    graceEndsAtMs: number;
  }): Promise<void>;

  /** The grace ran out. Says what stopped, which is narrow. */
  lapsed(args: {
    connectionId: string;
    organizationId: string;
    domain: string;
  }): Promise<void>;
}

/** What one sweep did, for the worker's log line and for a test to assert on
 *  without reading a ledger. */
export interface SsoDomainReproofOutcome {
  /** Whether the batch filled, so more domains are waiting for the next
   *  cycle. Reported rather than inferred, because a sweep that silently
   *  covers half the fleet reads exactly like one that covered all of it. */
  truncated?: boolean;
  checked: number;
  wavered: number;
  lapsed: number;
  recovered: number;
  /** Lookups that could not be answered. Counted rather than acted on. */
  unreachable: number;
  /** Domains whose re-read threw. Carried out rather than logged here, so the
   *  package stays free of a logger and the worker says it once. */
  failed: { domain: string; error: unknown }[];
}

export interface SsoDomainReproofServiceDeps {
  connections: () => SsoConnectionService;
  targets: SsoDomainReproofTargetRepository;
  proofs: SsoDomainProofLookup;
  /** The file channel's re-read, for domains the file proved. */
  files: SsoDomainFileLookup;
  notifier: SsoDomainReproofNotifier;
  /** How long a domain keeps vouching after its record goes missing. Passed
   *  in rather than read here, so the window is one composed constant. */
  graceMs?: number;
  now?: () => number;
}

/** How many domains one sweep re-reads. A ceiling rather than a page: a
 *  deployment with more proved domains than this is one whose sweep should be
 *  a conversation about capacity, not one that silently skips half of them. */
export const SSO_DOMAIN_REPROOF_BATCH = 500;

export class SsoDomainReproofService {
  private readonly now: () => number;
  private readonly graceMs: number;

  constructor(private readonly deps: SsoDomainReproofServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.graceMs = deps.graceMs ?? SSO_DNS_REPROOF_GRACE_MS;
  }

  /**
   * One sweep. Every domain is independent: a lookup that throws, a command
   * a guard refuses, or an email nobody could send stops that domain and
   * nothing else, because a sweep that abandons four hundred domains over one
   * bad one is a sweep that silently stops working.
   */
  async sweep(): Promise<SsoDomainReproofOutcome> {
    const targets = await this.deps.targets.findDomainsProvedByRecord({
      limit: SSO_DOMAIN_REPROOF_BATCH,
    });
    const outcome: SsoDomainReproofOutcome = {
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
        // One domain's failure is one domain's failure. A sweep that abandons
        // four hundred domains over a single refused command is a sweep that
        // silently stops working, and the next cycle re-reads this one anyway.
        outcome.failed.push({ domain: target.domain, error });
      }
    }

    // Stamped for every target taken, including the ones that failed: the
    // question this answers is "has the sweep looked at you", and a
    // connection whose look threw must still go to the back of the queue or
    // it blocks every connection behind it forever.
    if (targets.length > 0) {
      await this.deps.targets.markSwept({
        connectionIds: [
          ...new Set(targets.map((target) => target.connectionId)),
        ],
        atMs: this.now(),
      });
    }

    outcome.truncated = targets.length >= SSO_DOMAIN_REPROOF_BATCH;
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
    // The evidence is re-read where the verified fact says it lives: the
    // TXT name for a record-proved domain, the well-known address for a
    // file-proved one. Both answer in the same three outcomes.
    const lookup =
      target.method === "https-file"
        ? await this.deps.files.fetchVerificationFile({
            domain,
            url: ssoVerificationFileUrl({ domain }),
          })
        : await this.deps.proofs.lookupTxtValues({
            domain,
            name: ssoDnsRecordName({ domain }),
          });
    outcome.checked += 1;
    // The neutral answer, and the only one with no verb. Counted so an
    // operator can see a resolver having a bad day, and acted on in no other
    // way at all.
    if (lookup.outcome === "unreachable") {
      outcome.unreachable += 1;
      return;
    }
    const facts =
      lookup.outcome !== "absent" &&
      matchesToken({ tokenHash: target.tokenHash, values: lookup.values })
        ? await this.deps
            .connections()
            .recordDomainProofPresent({ ...this.command(target), domain })
        : await this.deps.connections().recordDomainProofAbsent({
            ...this.command(target),
            domain,
            graceMs: this.graceMs,
          });

    for (const fact of facts) {
      if (fact.type === "lw.identity.domain_proof_wavered") {
        outcome.wavered += 1;
        await this.deps.notifier.wavering({
          connectionId: target.connectionId,
          organizationId: target.organizationId,
          domain,
          graceEndsAtMs: fact.data.graceEndsAtMs,
        });
      }
      if (fact.type === "lw.identity.domain_proof_lapsed") {
        outcome.lapsed += 1;
        await this.deps.notifier.lapsed({
          connectionId: target.connectionId,
          organizationId: target.organizationId,
          domain,
        });
      }
      if (fact.type === "lw.identity.domain_proof_recovered") {
        outcome.recovered += 1;
      }
    }
  }

  /**
   * The identity block a sweep's command carries. The actor is the SYSTEM,
   * and the history says so: nobody decided a record was missing, we looked.
   * The command id is fresh per check rather than derived from the domain,
   * because two checks a day apart are two genuinely different observations
   * and must not dedupe into one.
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

/**
 * Whether one of the published values is the token this domain was proved
 * with.
 *
 * A constant-time comparison against the HASH the ceremony recorded, for the
 * same reason the first check used one: the token is not public until the
 * customer publishes it, and a comparison that leaks how nearly a value
 * matched is a comparison worth not writing.
 */
function matchesToken({
  tokenHash,
  values,
}: {
  tokenHash: string;
  values: string[];
}): boolean {
  return values.some((value) =>
    safeEqual(`sha256:${sha256Hex(value.trim())}`, tokenHash),
  );
}
