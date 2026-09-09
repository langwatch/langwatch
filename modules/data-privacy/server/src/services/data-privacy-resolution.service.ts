import type { DataPrivacyPolicy, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { DataPrivacyProjectPort } from "../ports/data-privacy.port.ts";
import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import { DataPrivacyPolicyCacheService } from "./data-privacy-cache.service.ts";

/**
 * The policy a scope resolves to, and the two reads that support it. Three operations that
 * stand on the policy repository, its cache and one project read.
 */
export class DataPrivacyResolutionService {
  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly cache: DataPrivacyPolicyCacheService,
    private readonly projects: DataPrivacyProjectPort,
  ) {}

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    projects: DataPrivacyProjectPort;
    cache?: DataPrivacyPolicyCacheService;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyResolutionService {
    return new DataPrivacyResolutionService(
      options.repository,
      options.cache ??
        DataPrivacyPolicyCacheService.create(options.repository, options.ttlMs, options.now),
      options.projects,
    );
  }

  async getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    const project = await this.projects.getWithTeam(input.projectId);

    return this.cache.resolve({
      projectId: project.id,
      facts: {
        organizationId: project.team.organizationId,
        teamId: project.teamId,
        projectId: project.id,
        departmentId: project.departmentId,
        isPersonal: project.isPersonal,
      },
    });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.repository.findAllInOrganization(input);
  }
}
