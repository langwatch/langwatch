import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { PaginatedProjects, Project, ProjectApi } from "@langwatch/project-contract";

/** The page a listing asks for, the key whose reach cuts it, and the person it acts for. */
export type VisibleProjectsQuery = Readonly<{
  apiKeyId: string;
  /** The key's owner; null for a service key, which acts for nobody. */
  userId: string | null;
  organizationId: string;
  page: number;
  limit: number;
}>;

/** What a provisioning request names: the project, and the team it goes into or creates. */
export type ProjectProvisioningRequest = Readonly<{
  organizationId: string;
  userId: string | null;
  teamId?: string | undefined;
  newTeamName?: string | undefined;
  name: string;
  language: string;
  framework: string;
}>;

/** A provisioned project, with the service key minted beside it. */
export type ProvisionedProject = Readonly<{
  project: Project;
  serviceKey: Readonly<{ token: string; apiKeyId: string }>;
}>;

/**
 * The `/api/projects` collection behind an organization key: a listing cut to
 * what the presented key reaches, and a project provisioned with an ADMIN
 * service key on it alone, belonging to no member.
 */
export class ProjectProvisioningService {
  static create(options: {
    apiKeys: Pick<ApiKeyApi, "create" | "resolveVisibleProjects">;
    projects: Pick<ProjectApi, "createInOrganization" | "listByOrganization">;
  }): ProjectProvisioningService {
    return new ProjectProvisioningService(options);
  }

  private constructor(
    private readonly options: {
      apiKeys: Pick<ApiKeyApi, "create" | "resolveVisibleProjects">;
      projects: Pick<ProjectApi, "createInOrganization" | "listByOrganization">;
    },
  ) {}

  async listVisibleProjects(input: VisibleProjectsQuery): Promise<PaginatedProjects> {
    const visible = await this.options.apiKeys.resolveVisibleProjects({
      apiKeyId: input.apiKeyId,
      organizationId: input.organizationId,
    });

    return this.options.projects.listByOrganization({
      organizationId: input.organizationId,
      page: input.page,
      limit: input.limit,
      ...(visible.kind === "some" ? { projectIds: visible.ids } : {}),
      // ADR-175 decision 5: an aggregate is listed only to an organisation admin.
      aggregatesVisibleTo: { userId: input.userId },
    });
  }

  async provisionProject(input: ProjectProvisioningRequest): Promise<ProvisionedProject> {
    const project = await this.options.projects.createInOrganization(input);
    const created = await this.options.apiKeys.create({
      name: `${project.name} Service Key`,
      userId: null,
      createdByUserId: input.userId,
      organizationId: input.organizationId,
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: project.id }],
    });

    return { project, serviceKey: { token: created.token, apiKeyId: created.apiKey.id } };
  }
}
