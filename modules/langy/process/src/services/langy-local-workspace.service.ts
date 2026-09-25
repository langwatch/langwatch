import type { GithubApi } from "@langwatch/github-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ProjectNotFoundError, type ProjectApi } from "@langwatch/project-contract";
import type { UserApi, UserCodeAccessPreference } from "@langwatch/user-contract";

import {
  SkipPermissionsService,
  type SkipPermissionsDecision,
} from "./langy-skip-permissions.service.ts";

/** The GitHub half of the code access card. */
export type LangyGithubInstallationState = { installed: boolean; accountLogin?: string };

/**
 * The peer reads the local doors make: the person's code access choice, the
 * organization's GitHub App, the project's slug and organization, and whether a
 * model may skip permission cards. Ported from main's `routes/langy-local.ts`.
 */
export class LangyLocalWorkspaceService {
  readonly #users: Pick<UserApi, "getLangyCodeAccessPreference" | "setLangyCodeAccessPreference">;
  readonly #github: Pick<GithubApi, "getAllForOrganization">;
  readonly #projects: Pick<
    ProjectApi,
    "findOrganizationId" | "getOrganizationId" | "findSummaryById"
  >;
  readonly #modelProviders: Pick<ModelProviderApi, "findAllAccessibleForProject">;

  private constructor(options: {
    users: Pick<UserApi, "getLangyCodeAccessPreference" | "setLangyCodeAccessPreference">;
    github: Pick<GithubApi, "getAllForOrganization">;
    projects: Pick<ProjectApi, "findOrganizationId" | "getOrganizationId" | "findSummaryById">;
    modelProviders: Pick<ModelProviderApi, "findAllAccessibleForProject">;
  }) {
    this.#users = options.users;
    this.#github = options.github;
    this.#projects = options.projects;
    this.#modelProviders = options.modelProviders;
  }

  static create(options: {
    users: Pick<UserApi, "getLangyCodeAccessPreference" | "setLangyCodeAccessPreference">;
    github: Pick<GithubApi, "getAllForOrganization">;
    projects: Pick<ProjectApi, "findOrganizationId" | "getOrganizationId" | "findSummaryById">;
    modelProviders: Pick<ModelProviderApi, "findAllAccessibleForProject">;
  }): LangyLocalWorkspaceService {
    return new LangyLocalWorkspaceService(options);
  }

  getCodeAccessPreference(userId: string): Promise<UserCodeAccessPreference> {
    return this.#users.getLangyCodeAccessPreference({ id: userId });
  }

  async setCodeAccessPreference(input: {
    userId: string;
    preference: "github" | null;
  }): Promise<UserCodeAccessPreference> {
    await this.#users.setLangyCodeAccessPreference({
      id: input.userId,
      preference: input.preference,
    });
    return { preference: input.preference };
  }

  /** The first installation that is not suspended; "not installed" without an organization. */
  async getGithubInstallation(projectId: string): Promise<LangyGithubInstallationState> {
    const organizationId = await this.#projects.findOrganizationId(projectId);
    if (!organizationId) return { installed: false };
    const installations = await this.#github.getAllForOrganization(organizationId);
    const first = installations.find((row) => row.suspendedAt == null);
    return first ? { installed: true, accountLogin: first.accountLogin } : { installed: false };
  }

  getOrganizationId(projectId: string): Promise<string> {
    return this.#projects.getOrganizationId(projectId);
  }

  async getSlug(projectId: string): Promise<string> {
    const summary = await this.#projects.findSummaryById(projectId);
    if (!summary) throw new ProjectNotFoundError();
    return summary.slug;
  }

  async canSkipPermissions(input: { projectId: string; model: string }): Promise<{
    allowed: boolean;
  }> {
    const { allowed } = await this.getSkipPermissionsDecision(input);
    return { allowed };
  }

  /** The skip verdict with the provider and model it resolved, for recording the policy. */
  getSkipPermissionsDecision(input: {
    projectId: string;
    model: string;
  }): Promise<SkipPermissionsDecision> {
    return SkipPermissionsService.canModelSkipPermissions({
      ...input,
      providerRows: {
        findAllAccessibleForProject: async (projectId) =>
          (await this.#modelProviders.findAllAccessibleForProject({ projectId })).map((row) => ({
            ...row,
            langySkipPermissionsModels: row.langySkipPermissionsModels ?? null,
          })),
      },
    });
  }
}
