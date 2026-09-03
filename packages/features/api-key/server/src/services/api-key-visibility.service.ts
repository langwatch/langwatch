import { ProjectVisibilityTooWideError } from "@langwatch/api-key-contract";
import {
  apiKeyVisibleProjectsInputSchema,
  type ApiKeyVisibleProjects,
} from "@langwatch/api-key-contract";
import type { ApiKeyRepository } from "../repositories/api-key.repository";
import type { ApiKeyDependencies } from "./api-key.service";

const MAX_VISIBLE_PROJECT_CANDIDATES = 5_000;
export class ApiKeyVisibilityService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
  ): ApiKeyVisibilityService {
    return new ApiKeyVisibilityService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {}

  async resolveVisibleProjects(input: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<ApiKeyVisibleProjects> {
    const parsed = apiKeyVisibleProjectsInputSchema.parse(input);
    const key = await this.repository.tryFindByIdInOrganization({
      id: parsed.apiKeyId,
      organizationId: parsed.organizationId,
    });
    if (!key) {
      return { kind: "some", ids: [] };
    }

    const principal = { type: "apiKey" as const, id: key.id };
    const organizationWide = await this.options.authz.can({
      principal,
      permission: "project:view",
      scope: { type: "organization", id: parsed.organizationId },
    });
    if (organizationWide) {
      return { kind: "all" };
    }

    const teamIds = [
      ...new Set(
        key.roleBindings.flatMap((binding) =>
          binding.scopeType === "TEAM" ? [binding.scopeId] : [],
        ),
      ),
    ];
    const projectIds = [
      ...new Set(
        key.roleBindings.flatMap((binding) =>
          binding.scopeType === "PROJECT" ? [binding.scopeId] : [],
        ),
      ),
    ];
    const candidates = await this.options.projects.listActiveByScopes({
      organizationId: parsed.organizationId,
      organizationWide: key.roleBindings.some((binding) => binding.scopeType === "ORGANIZATION"),
      teamIds,
      projectIds,
      limit: MAX_VISIBLE_PROJECT_CANDIDATES,
    });
    if (candidates.hasMore) {
      throw new ProjectVisibilityTooWideError(
        `Resolving this credential's project visibility would scan more than ${MAX_VISIBLE_PROJECT_CANDIDATES} projects`,
        {
          meta: {
            organizationId: parsed.organizationId,
            limit: MAX_VISIBLE_PROJECT_CANDIDATES,
          },
        },
      );
    }
    if (candidates.data.length === 0) {
      return { kind: "some", ids: [] };
    }

    const decision = await this.options.authz.canBatchByIds({
      principal,
      permission: "project:view",
      organizationId: parsed.organizationId,
      teams: [],
      projects: candidates.data.map((project) => ({
        projectId: project.id,
        teamId: project.teamId,
      })),
    });
    return {
      kind: "some",
      ids: candidates.data
        .filter((project) => decision.projects.get(project.id) === true)
        .map((project) => project.id),
    };
  }
}
