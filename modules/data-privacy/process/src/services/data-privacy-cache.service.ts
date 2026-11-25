import {
  buildDataPrivacyChain,
  resolveDataPrivacy,
  type DataPrivacyScopeFacts,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { nowInstant } from "@langwatch/time";

import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import { ProjectLookupCacheService } from "./project-lookup-cache.service.ts";

export class DataPrivacyPolicyCacheService {
  static create(
    repository: DataPrivacyPolicyRepository,
    ttlMs = 60_000,
    now: () => number = () => nowInstant().epochMilliseconds,
  ): DataPrivacyPolicyCacheService {
    return new DataPrivacyPolicyCacheService(
      repository,
      ProjectLookupCacheService.create<ResolvedDataPrivacy>({ ttlMs, now }),
    );
  }

  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    /** Concurrent misses of one project share one cascade walk (ADR-177). */
    private readonly policies: ProjectLookupCacheService<ResolvedDataPrivacy>,
  ) {}

  /** `facts` is read only on a miss: the ingest hot path reads placement once per window. */
  resolve(input: {
    projectId: string;
    facts: () => Promise<DataPrivacyScopeFacts>;
  }): Promise<ResolvedDataPrivacy> {
    return this.policies.get(input.projectId, async () => {
      const facts = await input.facts();
      return resolveDataPrivacy({
        rows: await this.repository.findForProjectChain({
          organizationId: facts.organizationId,
          scopes: buildDataPrivacyChain(facts),
        }),
        facts,
      });
    });
  }

  clear(): void {
    this.policies.clear();
  }
}
