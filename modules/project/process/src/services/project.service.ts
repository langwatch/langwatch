import {
  type OrganizationApi,
  type OrganizationTeam,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import {
  PROJECT_KIND,
  activeProjectsByScopesInputSchema,
  createProjectInputSchema,
  internalProjectKindSchema,
  internalProjectQuerySchema,
  projectPaginationSchema,
  projectIdsByOrganizationInputSchema,
  projectNamesByIdsInputSchema,
  projectPresenceInputSchema,
  type ActiveProjectsByScopes,
  type ActiveProjectsByScopesInput,
  type InternalProject,
  type InternalProjectKind,
  type InternalProjectQuery,
  type OrgAdminResolution,
  type PaginatedProjects,
  type ArchivedProject,
  type Project,
  type ProjectIdentity,
  type ProjectPath,
  type ProjectWithTeam,
  type SearchProjectsResult,
  type TraceSharingConfig,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
  traceDestinationInputSchema,
  traceDestinationProjectIdSchema,
  traceDestinationProjectIdsSchema,
  type UpdateProjectInput,
  DestinationTeamNotFoundError,
  assertPersonalProjectArchivable,
  assertPersonalWorkspaceCreate,
  assertPersonalWorkspaceMove,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectUsageCount,
} from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

import type { ProjectRepository } from "../repositories/project.repository.ts";
import { codingAgentActivityStaleBefore } from "../rules/coding-agent-activity.rules.ts";
import { mintProjectSlug } from "../rules/project-slug-service.rules.ts";
import type { ProjectCredentials } from "./project-credentials.service.ts";
import { ProjectMetadataService } from "./project-metadata.service.ts";

/** The LWQL column mapping a project's ingestion key is synced to. Nothing in
 * this module implements it yet — it is the one caller-supplied capability
 * `create` reaches for, kept optional until a concrete channel exists. */
export abstract class ProjectKeyMap {
  abstract syncProject(input: { projectId: string; lwqlKey: string }): Promise<void>;
}

/** The project's own stored objects (attachments, blobs) in whatever object
 * store owns them. Optional for the same reason as `ProjectKeyMap`: `archive`
 * reaches for it, nothing in this module implements it yet. */
export abstract class ProjectStoredObjects {
  abstract deleteOwnedBy(input: { projectId: string }): Promise<void>;
}

/** Where a read that must not fail the caller reports its cause instead. */
export abstract class ProjectDiagnostics {
  abstract error(context: Record<string, unknown>, message: string): void;
  abstract capture(error: Error, context: Record<string, unknown>): void;
}

export class ProjectService {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]> {
    return this.repository.findPaths(input);
  }

  findProjectsWithDepartments(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]> {
    return this.repository.findProjectsWithDepartments(input);
  }

  assignProjectDepartment(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.repository.assignProjectDepartment(input);
  }

  private readonly metadata: ProjectMetadataService;
  private readonly repository: ProjectRepository;
  private readonly credentials: ProjectCredentials;
  private readonly organizations: OrganizationApi;
  private readonly keyMap?: ProjectKeyMap;
  private readonly storedObjects?: ProjectStoredObjects;
  private readonly diagnostics?: ProjectDiagnostics;

  private constructor({
    metadata,
    repository,
    credentials,
    organizations,
    keyMap,
    storedObjects,
    diagnostics,
  }: {
    metadata: ProjectMetadataService;
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    keyMap?: ProjectKeyMap;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
  }) {
    this.metadata = metadata;
    this.repository = repository;
    this.credentials = credentials;
    this.organizations = organizations;
    this.keyMap = keyMap;
    this.storedObjects = storedObjects;
    this.diagnostics = diagnostics;
  }

  static create(options: {
    repository: ProjectRepository;
    credentials: ProjectCredentials;
    organizations: OrganizationApi;
    keyMap?: ProjectKeyMap;
    storedObjects?: ProjectStoredObjects;
    diagnostics?: ProjectDiagnostics;
  }): ProjectService {
    return new ProjectService({
      metadata: ProjectMetadataService.create({
        repository: options.repository,
        ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
      }),
      repository: options.repository,
      credentials: options.credentials,
      organizations: options.organizations,
      keyMap: options.keyMap,
      storedObjects: options.storedObjects,
      diagnostics: options.diagnostics,
    });
  }

  findInternal(input: InternalProjectQuery): Promise<InternalProject | null> {
    const parsed = internalProjectQuerySchema.parse(input);

    return this.repository.findInternalByOrganization(parsed.organizationId);
  }

  findInternalIds(input: { kind: InternalProjectKind }): Promise<string[]> {
    return this.repository.findLiveInternalIds({
      kind: internalProjectKindSchema.parse(input.kind),
    });
  }

  async resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision> {
    const parsed = traceDestinationInputSchema.parse(input);
    if (parsed.traceProjectId) {
      const project = await this.repository.findLiveTraceDestination({
        organizationId: parsed.organizationId,
        projectId: parsed.traceProjectId,
      });
      return project ? { outcome: "resolved", project } : { outcome: "unknown" };
    }

    if (parsed.projectScopeIds.length === 1) {
      const project = await this.repository.findLiveTraceDestination({
        organizationId: parsed.organizationId,
        projectId: parsed.projectScopeIds[0]!,
      });
      if (project) {
        return { outcome: "resolved", project };
      }
    }

    const governance = await this.repository.findOldestGovernanceTraceDestination(
      parsed.organizationId,
    );
    if (!governance) {
      return { outcome: "no_destination" };
    }

    const alternatives = await this.repository.countLiveNonGovernanceProjects(
      parsed.organizationId,
    );
    return alternatives > 0
      ? { outcome: "ambiguous", projectScopeCount: parsed.projectScopeIds.length }
      : { outcome: "resolved", project: governance };
  }

  findTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    return this.repository.findTraceDestination(traceDestinationProjectIdSchema.parse(projectId));
  }

  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    const parsed = traceDestinationProjectIdsSchema.parse(projectIds);

    return this.repository.findTraceDestinations([...new Set(parsed)]);
  }

  async ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    const parsed = internalProjectQuerySchema.parse(input);
    const existing = await this.repository.findInternalByOrganization(parsed.organizationId);
    if (existing) {
      return existing;
    }

    const teamId = await this.organizations.getOldestTeamId({
      organizationId: parsed.organizationId,
    });
    const slug = `governance-${parsed.organizationId}`;
    const bySlug = await this.repository.findInternalBySlug(slug);
    if (bySlug?.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) {
      return bySlug;
    }

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
    const project = await this.repository.findById(id);
    if (!project) {
      throw new ProjectNotFoundError("Project not found");
    }

    return project;
  }

  async getOrganizationId(projectId: string): Promise<string> {
    const project = await this.getWithTeam(projectId);

    return project.team.organizationId;
  }

  findOrganizationId(projectId: string): Promise<string | undefined> {
    return this.repository.findOrganizationId(projectId);
  }

  findIdentity(id: string): Promise<ProjectIdentity | null> {
    return this.repository.findIdentity(id);
  }

  findById(projectId: string): Promise<Project | null> {
    return this.metadata.findById(projectId);
  }

  async findSummaryById(projectId: string): Promise<{ name: string; slug: string } | null> {
    const project = await this.repository.findById(projectId);

    return project ? { name: project.name, slug: project.slug } : null;
  }

  getWithTeam(id: string): Promise<ProjectWithTeam> {
    return this.metadata.getWithTeam(id);
  }

  findWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.metadata.findWithTeam(id);
  }

  private async assertTeamCanHoldANewProject(input: {
    teamId: string;
    organizationId: string;
  }): Promise<void> {
    const [destinationTeam] = await this.findActiveTeam(input);
    if (!destinationTeam) {
      throw new TeamNotInOrganizationError("Team does not belong to this organization");
    }

    assertPersonalWorkspaceCreate(destinationTeam.isPersonal);
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
    const existing = await this.repository.findBySlugInTeam({ slug, teamId });
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
    const data = input.data;
    if (data.teamId) {
      const [team] = await this.findActiveTeam({
        teamId: data.teamId,
        organizationId: input.organizationId,
      });
      if (!team) {
        throw new DestinationTeamNotFoundError(
          "Destination team not found, is archived, or belongs to a different organization",
        );
      }

      const current = await this.repository.findWithTeam(input.id);
      if (
        current &&
        current.team.organizationId === input.organizationId &&
        current.teamId !== data.teamId
      ) {
        assertPersonalWorkspaceMove({
          isProjectPersonal: current.isPersonal,
          isDestinationTeamPersonal: team.isPersonal,
        });
      }
    }

    const project = await this.repository.update({
      id: input.id,
      organizationId: input.organizationId,
      data,
    });

    return project;
  }

  async archive(input: { id: string; organizationId: string }): Promise<ArchivedProject> {
    const existing = await this.repository.findWithTeam(input.id);
    if (existing && existing.team.organizationId === input.organizationId) {
      assertPersonalProjectArchivable(existing.isPersonal);
    }

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
    return this.repository.listAllByOrganization(projectPaginationSchema.parse(input));
  }

  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.repository.findAllByTeam(input);
  }

  listNamesByIds(input: { projectIds: string[] }): Promise<ProjectIdentity[]> {
    const parsed = projectNamesByIdsInputSchema.parse(input);

    return this.repository.findNamesByIds([...new Set(parsed.projectIds)]);
  }

  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<ProjectUsageCount> {
    return this.repository.countUsage(input);
  }

  countWithTraces(input: { organizationId: string }): Promise<number> {
    return this.repository.countWithTraces(input);
  }

  findSharedProjectSlugs(input: {
    organizationId: string;
    memberUserId?: string;
    limit: number;
  }): Promise<string[]> {
    return this.repository.findSharedProjectSlugs(input);
  }

  listIdsByOrganization(input: { organizationId: string }): Promise<string[]> {
    const parsed = projectIdsByOrganizationInputSchema.parse(input);

    return this.repository.findIdsByOrganization(parsed.organizationId);
  }

  findLiveNonGovernanceIdsByOrganization(input: { organizationId: string }): Promise<string[]> {
    const parsed = projectIdsByOrganizationInputSchema.parse(input);

    return this.repository.findLiveNonGovernanceIds(parsed.organizationId);
  }

  findLiveBySlug(input: { slug: string; organizationId: string }): Promise<Project[]> {
    return this.repository.findLiveBySlugInOrganization(input);
  }

  async findLiveByRef(input: { projectRef: string; organizationId: string }): Promise<Project[]> {
    const byId = await this.repository.findLiveByIdInOrganization({
      id: input.projectRef,
      organizationId: input.organizationId,
    });
    if (byId.length > 0) return byId;

    return this.repository.findLiveBySlugInOrganization({
      slug: input.projectRef,
      organizationId: input.organizationId,
    });
  }

  async listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes> {
    const parsed = activeProjectsByScopesInputSchema.parse(input);
    if (!parsed.organizationWide && parsed.teamIds.length === 0 && parsed.projectIds.length === 0) {
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
    return this.metadata.updateMetadata(input);
  }

  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.repository.touchCodingAgentSessionSeen({
      ...input,
      staleBefore: codingAgentActivityStaleBefore(input.at),
    });
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.repository.touchCodingAgentPullRequestSeen({
      ...input,
      staleBefore: codingAgentActivityStaleBefore(input.at),
    });
  }

  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.repository.searchByQuery(input);
  }

  /**
   * Kept on the `tryGet*` spelling because the dying abstract contract still
   * declares it; the `find*` name a nullable answer earns lives on `ProjectApi`
   * and on the repository below.
   */
  findTraceSharingConfig(projectId: string): Promise<TraceSharingConfig | null> {
    return this.repository.findTraceSharingConfig(projectId);
  }

  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    return this.metadata.resolveOrgAdmin(projectId);
  }

  /**
   * The three answers the credential side asks this module for. They live here
   * because the project and team rows are this module's, and a peer that reads
   * them itself would be a second owner of the same tables.
   */
  findIdByLegacyApiKey(input: { token: string }): Promise<string | null> {
    return this.repository.findIdByLegacyApiKey(input);
  }

  rotateLegacyApiKey(input: { projectId: string; token: string }): Promise<boolean> {
    return this.repository.rotateLegacyApiKey(input);
  }

  async findPersonalWorkspaceOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null> {
    const [team] = await this.organizations.findPersonalTeamOwners({
      organizationId: input.organizationId,
      teamIds: [input.scopeId],
    });
    if (team) return { ownerUserId: team.ownerUserId };
    return this.repository.findPersonalProjectOwner(input);
  }

  private async findActiveTeam(input: {
    teamId: string;
    organizationId: string;
  }): Promise<OrganizationTeam[]> {
    try {
      return [await this.organizations.getTeam(input)];
    } catch (error) {
      if (error instanceof TeamNotFoundError) return [];
      throw error;
    }
  }
}
