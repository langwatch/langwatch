import type { DataPrivacyPolicy, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { DataPrivacyProjectPort } from "../ports/data-privacy.port";
import type { DataPrivacyPolicyRepository } from "../ports/data-privacy.repository";
import { DataPrivacyPolicyCache } from "./data-privacy.cache";

/**
 * The policy a scope resolves to, and the two reads that support it.
 *
 * Three operations that stand on the policy repository, its cache and one
 * project read. They were methods of `DataPrivacyService`, which still answers
 * all three — it composes this and delegates, so there is one implementation
 * and no twin to drift — but a process that only ingests can now compose them
 * WITHOUT the write half.
 *
 * The write half is what drags the collaborators. `setForScope` and
 * `removeForScope` have to decide which organization a scope belongs to, and
 * for a team scope that answer is an `OrganizationService` call. Nothing below
 * asks it: a project's own row already carries the organization, team and
 * department the inheritance chain is built from.
 */
export class DataPrivacyResolutionService {
  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly cache: DataPrivacyPolicyCache,
    private readonly projects: DataPrivacyProjectPort,
  ) {}

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    projects: DataPrivacyProjectPort;
    cache?: DataPrivacyPolicyCache;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyResolutionService {
    return new DataPrivacyResolutionService(
      options.repository,
      options.cache ?? new DataPrivacyPolicyCache(options.repository, options.ttlMs, options.now),
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

  tryGetById(input: { id: string }): Promise<DataPrivacyPolicy | null> {
    return this.repository.tryFindById(input);
  }
}
