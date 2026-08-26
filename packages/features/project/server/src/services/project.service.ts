import {
  PROJECT_KIND,
  ProjectService as ProjectServiceContract,
  activeProjectsByScopesInputSchema,
  createProjectInputSchema,
  internalProjectQuerySchema,
  personalWorkspaceArchiveViolation,
  personalWorkspaceCreateViolation,
  personalWorkspaceMoveViolation,
  projectPaginationSchema,
  projectIdsByOrganizationInputSchema,
  projectNamesByIdsInputSchema,
  projectPresenceInputSchema,
  updateProjectInputSchema,
  type ActiveProjectsByScopes,
  type ActiveProjectsByScopesInput,
  type InternalProject,
  type InternalProjectQuery,
  type OrgAdminResolution,
  type PaginatedProjects,
  type Project,
  type ProjectName,
  type ProjectWithTeam,
  type SearchProjectsResult,
  type TraceSharingConfig,
  traceDestinationDecisionSchema,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
  traceDestinationInputSchema,
  traceDestinationProjectIdSchema,
  traceDestinationProjectIdsSchema,
  type UpdateProjectInput,
} from "@langwatch/project-contract";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
} from "@langwatch/project-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  type ProjectCredentialsPort,
  type ProjectDiagnosticsPort,
  type ProjectKeyMapPort,
  type ProjectStoredObjectsPort,
} from "../ports/project.port";
import type { ProjectRepository } from "../repositories/project.repository";

export const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll(/[:?&_]/g, "-")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function mintProjectSlug(name: string, projectId: string): string {
  const slug = `${slugify(name)}-${projectId.substring(0, 6)}`;
  const reserved = new Set([
    "admin",
    "api",
    "assets",
    "auth",
    "authorize",
    "cli",
    "gateway",
    "governance",
    "invite",
    "mcp",
    "me",
    "onboarding",
    "ops",
    "settings",
    "share",
    "unsubscribe",
  ]);
  if (reserved.has(slug)) {
    throw new Error(`Minted project slug "${slug}" equals a reserved top-level route`);
  }
  return slug;
}

export class ProjectService extends ProjectServiceContract {
  private constructor(
    private readonly repository: ProjectRepository,
    private readonly credentials: ProjectCredentialsPort,
    private readonly organizations: OrganizationService,
    private readonly keyMap?: ProjectKeyMapPort,
    private readonly storedObjects?: ProjectStoredObjectsPort,
    private readonly diagnostics?: ProjectDiagnosticsPort,
  ) {
    super();
  }

  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentialsPort;
    organizations: OrganizationService;
    keyMap?: ProjectKeyMapPort;
    storedObjects?: ProjectStoredObjectsPort;
    diagnostics?: ProjectDiagnosticsPort;
  }): ProjectService {
    return new ProjectService(
      options.repository,
      options.credentials,
      options.organizations,
      options.keyMap,
      options.storedObjects,
      options.diagnostics,
    );
  }

  tryFindInternal(input: InternalProjectQuery): Promise<InternalProject | null> {
    const parsed = internalProjectQuerySchema.parse(input);
    return this.repository.tryFindInternalByOrganization(parsed.organizationId);
  }

  async resolveTraceDestination(
    input: TraceDestinationInput,
  ): Promise<TraceDestinationDecision> {
    const parsed = traceDestinationInputSchema.parse(input);
    if (parsed.traceProjectId) {
      const project = await this.repository.tryFindLiveTraceDestination({
        organizationId: parsed.organizationId,
        projectId: parsed.traceProjectId,
      });
      const decision = project
        ? { outcome: "resolved" as const, project }
        : { outcome: "unknown" as const };

      return traceDestinationDecisionSchema.parse(decision);
    }

    if (parsed.projectScopeIds.length === 1) {
      const project = await this.repository.tryFindLiveTraceDestination({
        organizationId: parsed.organizationId,
        projectId: parsed.projectScopeIds[0]!,
      });
      if (project) {
        return traceDestinationDecisionSchema.parse({ outcome: "resolved", project });
      }
    }

    const governance = await this.repository.tryFindOldestGovernanceTraceDestination(
      parsed.organizationId,
    );
    if (!governance) {
      return { outcome: "no_destination" };
    }

    const alternatives = await this.repository.countLiveNonGovernanceProjects(
      parsed.organizationId,
    );
    const decision =
      alternatives > 0
        ? {
            outcome: "ambiguous" as const,
            projectScopeCount: parsed.projectScopeIds.length,
          }
        : { outcome: "resolved" as const, project: governance };

    return traceDestinationDecisionSchema.parse(decision);
  }

  tryGetTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    return this.repository.tryGetTraceDestination(
      traceDestinationProjectIdSchema.parse(projectId),
    );
  }

  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    const parsed = traceDestinationProjectIdsSchema.parse(projectIds);
    return this.repository.listTraceDestinations([...new Set(parsed)]);
  }

  async ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    const parsed = internalProjectQuerySchema.parse(input);
    const existing = await this.repository.tryFindInternalByOrganization(
      parsed.organizationId,
    );
    if (existing) return existing;

    const teamId = await this.organizations.getOldestTeamId({
      organizationId: parsed.organizationId,
    });
    const slug = `governance-${parsed.organizationId}`;
    const bySlug = await this.repository.tryFindInternalBySlug(slug);
    if (bySlug?.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) return bySlug;

    return this.repository.createInternalOrFindWinner({
      id: this.credentials.generateProjectId(),
      name: "Governance (internal)",
      slug,
      apiKey: this.credentials.generateApiKey(),
      teamId,
    });
  }

  isPresenceEnabled(input: { projectId: string }): Promise<boolean> {
    const parsed = projectPresenceInputSchema.parse(input);
    return this.repository.isPresenceEnabled(parsed.projectId);
  }

  async getById(id: string): Promise<Project> {
    const project = await this.repository.tryGetById(id);
    if (!project) throw new ProjectNotFoundError("Project not found");
    return project;
  }

  async getOrganizationId(projectId: string): Promise<string> {
    const project = await this.getWithTeam(projectId);
    return project.team.organizationId;
  }

  tryGetById(projectId: string): Promise<Project | null> {
    return this.repository.tryGetById(projectId);
  }

  async tryGetSummaryById(
    projectId: string,
  ): Promise<{ name: string; slug: string } | null> {
    const project = await this.repository.tryGetById(projectId);
    return project ? { name: project.name, slug: project.slug } : null;
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam> {
    const project = await this.repository.tryGetWithTeam(id);
    if (!project) throw new ProjectNotFoundError("Project not found");
    return project;
  }

  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.repository.tryGetWithTeam(id);
  }

  private async assertTeamCanHoldANewProject(input: {
    teamId: string;
    organizationId: string;
  }): Promise<void> {
    const destinationTeam = await this.repository.tryFindActiveTeamInOrganization(input);
    if (!destinationTeam) {
      throw new TeamNotInOrganizationError("Team does not belong to this organization");
    }
    const violation = personalWorkspaceCreateViolation(destinationTeam.isPersonal);
    if (violation) throw new PersonalWorkspaceBoundaryError(violation);
  }

  async create(input: {
    organizationId: string;
    userId?: string | null;
    teamId?: string;
    newTeamName?: string;
    name: string;
    language: string;
    framework: string;
  }): Promise<Project> {
    if (!input.teamId && !input.newTeamName) {
      throw new Error("Either teamId or newTeamName must be provided");
    }

    let teamId = input.teamId;
    if (teamId) {
      await this.assertTeamCanHoldANewProject({
        teamId,
        organizationId: input.organizationId,
      });
    } else {
      const teamName = input.newTeamName as string;
      const team = await this.organizations.createTeam({
        organizationId: input.organizationId,
        name: teamName,
      });
      if (input.userId) {
        await this.organizations.addTeamMember({
          teamId: team.id,
          organizationId: input.organizationId,
          userId: input.userId,
          role: "ADMIN",
          actor: { type: "user", id: input.userId },
        });
      }
      teamId = team.id;
    }

    const generatedId = this.credentials.generateProjectId();
    const projectId = `project_${generatedId}`;
    const slug = mintProjectSlug(input.name, generatedId);
    const existing = await this.repository.tryFindBySlugInTeam({ slug, teamId });
    if (existing) {
      throw new ProjectSlugConflictError(
        "A project with this name already exists in the selected team.",
      );
    }

    const project = await this.repository.create(
      createProjectInputSchema.parse({
        id: projectId,
        name: input.name,
        slug,
        language: input.language,
        framework: input.framework,
        teamId,
        apiKey: this.credentials.generateApiKey(),
      }),
    );
    try {
      await this.keyMap?.syncProject({
        projectId: project.id,
        lwqlKey: project.lwqlKey,
      });
    } catch (error) {
      this.diagnostics?.error(
        { projectId: project.id, error },
        "project key-map sync failed; backfill will retry",
      );
    }
    return project;
  }

  async update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const data = updateProjectInputSchema.parse(input.data);
    if (data.teamId) {
      const team = await this.repository.tryFindActiveTeamInOrganization({
        teamId: data.teamId,
        organizationId: input.organizationId,
      });
      if (!team) {
        throw new DestinationTeamNotFoundError(
          "Destination team not found, is archived, or belongs to a different organization",
        );
      }
      const current = await this.repository.tryGetWithTeam(input.id);
      if (
        current &&
        current.team.organizationId === input.organizationId &&
        current.teamId !== data.teamId
      ) {
        const violation = personalWorkspaceMoveViolation({
          isProjectPersonal: current.isPersonal,
          isDestinationTeamPersonal: team.isPersonal,
        });
        if (violation) throw new PersonalWorkspaceBoundaryError(violation);
      }
    }
    const project = await this.repository.update({
      id: input.id,
      organizationId: input.organizationId,
      data,
    });
    return project;
  }

  async archive(input: { id: string; organizationId: string }): Promise<Project> {
    const existing = await this.repository.tryGetWithTeam(input.id);
    const violation =
      existing && existing.team.organizationId === input.organizationId
        ? personalWorkspaceArchiveViolation(existing.isPersonal)
        : null;
    if (violation) throw new PersonalProjectProtectedError(violation);

    try {
      await this.storedObjects?.deleteOwnedBy({ projectId: input.id });
    } catch (error) {
      this.diagnostics?.error(
        { projectId: input.id, error },
        "stored-object cleanup failed during project archive; continuing",
      );
    }
    const project = await this.repository.archive(input);
    return project;
  }

  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    return this.repository.findAllByOrganization(projectPaginationSchema.parse(input));
  }

  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.repository.findAllByTeam(input);
  }

  listNamesByIds(input: { projectIds: string[] }): Promise<ProjectName[]> {
    const parsed = projectNamesByIdsInputSchema.parse(input);
    return this.repository.findNamesByIds([...new Set(parsed.projectIds)]);
  }

  listIdsByOrganization(input: { organizationId: string }): Promise<string[]> {
    const parsed = projectIdsByOrganizationInputSchema.parse(input);
    return this.repository.findIdsByOrganization(parsed.organizationId);
  }

  async listActiveByScopes(
    input: ActiveProjectsByScopesInput,
  ): Promise<ActiveProjectsByScopes> {
    const parsed = activeProjectsByScopesInputSchema.parse(input);
    if (
      !parsed.organizationWide &&
      parsed.teamIds.length === 0 &&
      parsed.projectIds.length === 0
    ) {
      return { data: [], hasMore: false };
    }
    const rows = await this.repository.findActiveByScopes(parsed);
    return {
      data: rows.slice(0, parsed.limit),
      hasMore: rows.length > parsed.limit,
    };
  }

  updateMetadata(input: {
    id: string;
    data: { firstMessage: boolean; integrated: boolean; language: string };
  }): Promise<void> {
    return this.repository.updateMetadata(input);
  }

  touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void> {
    return this.repository.touchCodingAgentSessionSeen({
      ...input,
      staleBefore: new Date(input.at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS),
    });
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void> {
    return this.repository.touchCodingAgentPullRequestSeen({
      ...input,
      staleBefore: new Date(input.at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS),
    });
  }

  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.repository.searchByQuery(input);
  }

  tryGetTraceSharingConfig(projectId: string): Promise<TraceSharingConfig | null> {
    return this.repository.tryGetTraceSharingConfig(projectId);
  }

  async resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    try {
      const result = await this.repository.tryGetWithOrgAdmin(projectId);
      if (!result) {
        return { userId: null, organizationId: null, firstMessage: false };
      }
      return {
        userId: result.adminUserId,
        organizationId: result.organizationId,
        firstMessage: result.firstMessage,
      };
    } catch (error) {
      const resolution = {
        projectId,
        error,
      };
      this.diagnostics?.error(
        resolution,
        "Failed to resolve org admin — returning null resolution",
      );
      this.diagnostics?.capture(new Error("Failed to resolve org admin"), resolution);
      return { userId: null, organizationId: null, firstMessage: false };
    }
  }
}
