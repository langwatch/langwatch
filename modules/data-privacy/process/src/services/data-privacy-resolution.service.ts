import type { DataPrivacyPolicy, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";

import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import { DataPrivacyPolicyCacheService } from "./data-privacy-cache.service.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";

type ScopeFacts = Pick<DataPrivacyProjectScopeService, "getScopeFacts">;

/**
 * The policy a scope resolves to, and the two reads that support it. Three operations that
 * stand on the policy repository, its cache and data privacy's own project-scope fold.
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

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    const facts = await this.scopes.getScopeFacts(input);

    return this.cache.resolve({ projectId: input.projectId, facts });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.repository.findAllInOrganization(input);
  }
}
