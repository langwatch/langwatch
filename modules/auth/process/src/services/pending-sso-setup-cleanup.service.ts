import {
  configuredSsoProviderStatus,
  extractEmailDomain,
  type OrganizationSsoProviderLookup,
} from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";

import type {
  PendingSsoSetupCandidate,
  PendingSsoSetupRepository,
} from "../repositories/pending-sso-setup.repository.ts";

const logger = createLogger("langwatch:auth:pending-sso-setup-cleanup");

const BATCH_SIZE = 200;

export type PendingSsoSetupCleanupResult = {
  scanned: number;
  cleared: number;
  stillPending: number;
  skipped: number;
  failed: number;
  isDryRun: boolean;
};

type Outcome = "cleared" | "stillPending" | "skipped";

export interface PendingSsoSetupCleanupServiceDeps {
  candidates: PendingSsoSetupRepository;
  organizations: OrganizationSsoProviderLookup;
}

/**
 * Clears a stale `pendingSsoSetup` wherever the person already holds an account
 * the domain's pin accepts, asking what `getSsoSetupStatus` asks. Idempotent:
 * a cleared person leaves the page. Spec: specs/auth/sso-wrong-provider-recovery.feature.
 */
export class PendingSsoSetupCleanupService {
  static create(deps: PendingSsoSetupCleanupServiceDeps): PendingSsoSetupCleanupService {
    return new PendingSsoSetupCleanupService(deps);
  }

  private constructor(private readonly deps: PendingSsoSetupCleanupServiceDeps) {}

  async clearStale({
    isDryRun,
    batchSize = BATCH_SIZE,
  }: {
    isDryRun: boolean;
    batchSize?: number;
  }): Promise<PendingSsoSetupCleanupResult> {
    const organizations = this.organizationsCachedForOneRun();
    const result: PendingSsoSetupCleanupResult = {
      scanned: 0,
      cleared: 0,
      stillPending: 0,
      skipped: 0,
      failed: 0,
      isDryRun,
    };

    let page = await this.deps.candidates.findPendingPage({ afterId: undefined, take: batchSize });
    while (page.length > 0) {
      for (const candidate of page) {
        result.scanned += 1;
        try {
          result[await this.resolve({ candidate, organizations, isDryRun })] += 1;
        } catch (error) {
          result.failed += 1;
          logger.error({ error, userId: candidate.id }, "failed to process user");
        }
      }

      if (page.length < batchSize) break;
      page = await this.deps.candidates.findPendingPage({
        afterId: page.at(-1)?.id,
        take: batchSize,
      });
    }

    return result;
  }

  private async resolve({
    candidate,
    organizations,
    isDryRun,
  }: {
    candidate: PendingSsoSetupCandidate;
    organizations: OrganizationSsoProviderLookup;
    isDryRun: boolean;
  }): Promise<Outcome> {
    const domain = extractEmailDomain(candidate.email);
    if (!domain) return "skipped";

    const status = await configuredSsoProviderStatus({
      organizations,
      domain,
      accounts: candidate.accounts,
    });
    if (status === "unmatched") return "stillPending";

    if (!isDryRun) await this.deps.candidates.clearPendingSsoSetup({ userId: candidate.id });
    return "cleared";
  }

  /** One lookup per domain per run; a failed lookup is forgotten, so one
   *  transient error does not fail every later person on that domain. */
  private organizationsCachedForOneRun(): OrganizationSsoProviderLookup {
    const cache = new Map<string, ReturnType<OrganizationSsoProviderLookup["findByDomain"]>>();
    return {
      findByDomain: ({ domain }) => {
        const cached = cache.get(domain);
        if (cached) return cached;
        const lookup = this.deps.organizations.findByDomain({ domain });
        cache.set(domain, lookup);
        lookup.catch(() => cache.delete(domain));
        return lookup;
      },
    };
  }
}
