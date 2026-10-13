import type {
  DataPrivacyPolicy,
  PrivacyPolicyRequestMemo,
  ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";

import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import { strictestDataPrivacy } from "../rules/strictest-data-privacy.rules.ts";
import { DataPrivacyPolicyCacheService } from "./data-privacy-cache.service.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";

type ScopeFacts = Pick<DataPrivacyProjectScopeService, "getScopeFacts">;

/**
 * The policy a scope resolves to, and the two reads that support it. Three operations that
 * stand on the policy repository, its cache and data privacy's placement reader.
 */
export class DataPrivacyResolutionService {
  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly cache: DataPrivacyPolicyCacheService,
    private readonly scopes: ScopeFacts,
  ) {}

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    scopes: ScopeFacts;
    cache?: DataPrivacyPolicyCacheService;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyResolutionService {
    return new DataPrivacyResolutionService(
      options.repository,
      options.cache ??
        DataPrivacyPolicyCacheService.create(options.repository, options.ttlMs, options.now),
      options.scopes,
    );
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    return this.cache.resolve({
      projectId: input.projectId,
      facts: () => this.scopes.getScopeFacts(input),
    });
  }

  /**
   * The strictest policy across several projects (ADR-177 decision 9): each project resolves
   * through its own cache entry, so no entry is keyed on the set. A request `memo` answers a
   * set already folded in this request; a failure is not remembered.
   */
  getResolvedForProjects(input: {
    projectIds: readonly string[];
    memo?: PrivacyPolicyRequestMemo;
  }): Promise<ResolvedDataPrivacy> {
    const distinct = [...new Set(input.projectIds)].toSorted();
    const { memo } = input;
    if (!memo) return this.foldResolved(distinct);
    const key = distinct.join(",");
    const remembered = memo.get(key);
    if (remembered) return remembered;
    const folded = this.foldResolved(distinct);
    memo.set(key, folded);
    folded.catch(() => {
      if (memo.get(key) === folded) memo.delete(key);
    });
    return folded;
  }

  private async foldResolved(distinct: readonly string[]): Promise<ResolvedDataPrivacy> {
    const [only] = distinct;
    if (distinct.length === 1 && only !== undefined) {
      return this.getResolvedForProject({ projectId: only });
    }
    return strictestDataPrivacy(
      await Promise.all(distinct.map((projectId) => this.getResolvedForProject({ projectId }))),
    );
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.repository.findAllInOrganization(input);
  }
}
