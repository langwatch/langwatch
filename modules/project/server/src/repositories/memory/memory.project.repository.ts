import {
  PROJECT_KIND,
  ProjectNotFoundError,
  internalProjectSchema,
  projectSchema,
  traceDestinationProjectSchema,
  type ActiveProjectsByScopesInput,
  type CreateProjectInput,
  type InternalProject,
  type PaginatedProjects,
  type Project,
  type ProjectIdentity,
  type ProjectPath,
  type ProjectWithTeam,
  type SearchProjectsResult,
  type TraceDestinationProject,
  type TraceSharingConfig,
  type UpdateProjectInput,
  type UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  ProjectRepository,
  ProjectWithOrgAdmin,
  TouchCodingAgentActivityInput,
} from "../project.repository.ts";
import { MemoryProjectDatabase } from "./memory.project.database.ts";

/** Newest first, then id, which is the order both listings are read in. */
function newestFirst(left: Project, right: Project): number {
  return right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export class MemoryProjectRepository implements ProjectRepository {
  readonly #database: MemoryProjectDatabase;

  private constructor(database: MemoryProjectDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryProjectDatabase }>): MemoryProjectRepository {
    return new MemoryProjectRepository(input.memory);
  }

  async listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]> {
    return input.projectIds.flatMap((projectId) => {
      const project = this.#database.findProject(projectId);
      if (!project) return [];
      const team = this.#database.findTeam(project.teamId);
      const organization = this.#database.findOrganizationOf(project);
      if (!team || !organization) return [];

      return [
        {
          projectId: project.id,
          fullPath: `${organization.name} / ${team.name} / ${project.name}`,
        },
      ];
    });
  }

  async tryFindInternalByOrganization(organizationId: string): Promise<InternalProject | null> {
    const project = this.#database
      .projects()
      .find(
        (row) =>
          row.kind === PROJECT_KIND.INTERNAL_GOVERNANCE &&
          row.archivedAt === null &&
          this.#database.isInOrganization(row, organizationId),
      );

    return project ? this.#internal(project) : null;
  }

  async tryFindInternalBySlug(slug: string): Promise<InternalProject | null> {
    const project = this.#database.projects().find((row) => row.slug === slug);
    if (!project || project.kind !== PROJECT_KIND.INTERNAL_GOVERNANCE) return null;

    return this.#internal(project);
  }

  async createInternalOrFindWinner(input: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
  }): Promise<InternalProject> {
    const winner = this.#database.projects().find((row) => row.slug === input.slug);
    if (winner) return this.#internal(winner);

    return this.#internal(
      this.#database.putProject(
        this.#row({
          id: input.id,
          name: input.name,
          slug: input.slug,
          apiKey: input.apiKey,
          teamId: input.teamId,
          language: "internal",
          framework: "governance",
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          traceSharingEnabled: false,
        }),
      ),
    );
  }

  async isPresenceEnabled(projectId: string): Promise<boolean> {
    const project = this.#database.findProject(projectId);
    const organization = project ? this.#database.findOrganizationOf(project) : undefined;

    return Boolean(project?.presenceEnabled && organization?.presenceEnabled);
  }

  async tryGetById(id: string): Promise<Project | null> {
    return this.#database.findProject(id) ?? null;
  }

  async tryGetOrganizationId(projectId: string): Promise<string | undefined> {
    const project = this.#database.findProject(projectId);

    return project ? this.#database.findTeam(project.teamId)?.organizationId : undefined;
  }

  async tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    const project = this.#database.findProject(id);
    if (!project || project.archivedAt !== null) return null;
    const team = this.#database.findTeam(project.teamId);
    if (!team) return null;

    return { ...project, team };
  }

  async updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void> {
    const project = this.#database.findProject(id);
    if (!project) return;
    this.#database.putProject({ ...project, ...data, updatedAt: toDate(nowInstant()) });
  }

  async touchCodingAgentSessionSeen(input: TouchCodingAgentActivityInput): Promise<void> {
    this.#touch(input, "lastCodingAgentSessionAt");
  }

  async touchCodingAgentPullRequestSeen(input: TouchCodingAgentActivityInput): Promise<void> {
    this.#touch(input, "lastCodingAgentPullRequestAt");
  }

  async tryGetWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null> {
    const project = this.#database.findProject(id);
    if (!project) return null;
    const organization = this.#database.findOrganizationOf(project);

    return {
      firstMessage: project.firstMessage,
      organizationId: organization?.id ?? null,
      adminUserId: organization?.adminUserIds[0] ?? null,
    };
  }

  async findTraceSharingConfig(id: string): Promise<TraceSharingConfig | null> {
    const project = this.#database.findProject(id);
    if (!project) return null;
    const organization = this.#database.findOrganizationOf(project);

    return {
      orgEnabled: organization?.traceSharingEnabled ?? false,
      projectEnabled: project.traceSharingEnabled,
    };
  }

  async searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.#database
      .projects()
      .filter(
        (project) =>
          (project.id.includes(input.query) ||
            contains(project.name, input.query) ||
            contains(project.slug, input.query)) &&
          (!input.organizationId || this.#database.isInOrganization(project, input.organizationId)),
      )
      .slice(0, input.limit ?? 20)
      .map(({ id, name, slug }) => ({ id, name, slug }));
  }

  async create(input: CreateProjectInput): Promise<Project> {
    return this.#database.putProject(this.#row(input));
  }

  async update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const project = this.#live(input.id, input.organizationId);

    return this.#database.putProject(
      projectSchema.parse({ ...project, ...input.data, updatedAt: toDate(nowInstant()) }),
    );
  }

  async archive(input: { id: string; organizationId: string }): Promise<Project> {
    const project = this.#live(input.id, input.organizationId);

    return this.#database.putProject({ ...project, archivedAt: toDate(nowInstant()) });
  }

  async findAllByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    const matching = this.#database
      .projects()
      .filter(
        (project) =>
          project.archivedAt === null &&
          this.#database.isInOrganization(project, input.organizationId) &&
          (!input.projectIds || input.projectIds.includes(project.id)),
      )
      .sort(newestFirst);
    const from = (input.page - 1) * input.limit;

    return {
      data: matching.slice(from, from + input.limit),
      pagination: { page: input.page, limit: input.limit, total: matching.length },
    };
  }

  async findAllByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.#database
      .projects()
      .filter(
        (project) =>
          project.teamId === input.teamId &&
          project.archivedAt === null &&
          project.kind !== PROJECT_KIND.INTERNAL_GOVERNANCE &&
          this.#database.isInOrganization(project, input.organizationId),
      )
      .sort(newestFirst);
  }

  async tryFindIdentity(id: string): Promise<ProjectIdentity | null> {
    const project = this.#database.findProject(id);

    return project ? this.#identity(project) : null;
  }

  async findNamesByIds(projectIds: string[]): Promise<ProjectIdentity[]> {
    return projectIds.flatMap((projectId) => {
      const project = this.#database.findProject(projectId);
      const identity = project ? this.#identity(project) : null;

      return identity ? [identity] : [];
    });
  }

  async findIdsByOrganization(organizationId: string): Promise<string[]> {
    return this.#database
      .projects()
      .filter((project) => this.#database.isInOrganization(project, organizationId))
      .map((project) => project.id);
  }

  async findActiveByScopes(input: ActiveProjectsByScopesInput): Promise<Project[]> {
    return this.#database
      .projects()
      .filter(
        (project) =>
          project.archivedAt === null &&
          this.#database.isInOrganization(project, input.organizationId) &&
          (input.organizationWide ||
            input.projectIds.includes(project.id) ||
            input.teamIds.includes(project.teamId)),
      )
      .sort(newestFirst)
      .slice(0, input.limit + 1);
  }

  async tryFindBySlugInTeam(input: { slug: string; teamId: string }): Promise<Project | null> {
    return (
      this.#database
        .projects()
        .find((project) => project.slug === input.slug && project.teamId === input.teamId) ?? null
    );
  }

  async tryFindActiveTeamInOrganization(input: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null> {
    const team = this.#database.findTeam(input.teamId);
    if (!team || team.organizationId !== input.organizationId || team.archivedAt !== null) {
      return null;
    }

    return { id: team.id, isPersonal: team.isPersonal };
  }

  async tryFindLiveTraceDestination(input: {
    organizationId: string;
    projectId: string;
  }): Promise<TraceDestinationProject | null> {
    const project = this.#database.findProject(input.projectId);
    if (
      !project ||
      project.archivedAt !== null ||
      !this.#database.isInOrganization(project, input.organizationId)
    ) {
      return null;
    }

    return this.#destination(project);
  }

  async tryFindOldestGovernanceTraceDestination(
    organizationId: string,
  ): Promise<TraceDestinationProject | null> {
    const project = this.#database
      .projects()
      .filter(
        (row) =>
          row.kind === PROJECT_KIND.INTERNAL_GOVERNANCE &&
          row.archivedAt === null &&
          this.#database.isInOrganization(row, organizationId),
      )
      .sort((left, right) => -newestFirst(left, right))[0];

    return project ? this.#destination(project) : null;
  }

  async countLiveNonGovernanceProjects(organizationId: string): Promise<number> {
    return this.#database
      .projects()
      .filter(
        (project) =>
          project.archivedAt === null &&
          project.kind !== PROJECT_KIND.INTERNAL_GOVERNANCE &&
          this.#database.isInOrganization(project, organizationId),
      ).length;
  }

  async tryGetTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    const project = this.#database.findProject(projectId);

    return project ? this.#destination(project) : null;
  }

  async listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    return projectIds.flatMap((projectId) => {
      const project = this.#database.findProject(projectId);

      return project ? [this.#destination(project)] : [];
    });
  }

  async findIdByLegacyApiKey(input: { token: string }): Promise<string | null> {
    const project = this.#database
      .projects()
      .find((row) => row.apiKey === input.token && row.archivedAt === null);

    return project?.id ?? null;
  }

  /** Answers false for a project this memory holds no live row for, as the fenced UPDATE does. */
  async rotateLegacyApiKey(input: { projectId: string; token: string }): Promise<boolean> {
    const project = this.#database.findProject(input.projectId);
    if (!project || project.archivedAt !== null) return false;
    this.#database.putProject({ ...project, apiKey: input.token });

    return true;
  }

  async findPersonalWorkspaceOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null> {
    const team = this.#database.findTeam(input.scopeId);
    if (team && team.organizationId === input.organizationId && team.isPersonal) {
      return { ownerUserId: team.ownerUserId };
    }

    const project = this.#database.findProject(input.scopeId);
    if (!project || project.archivedAt !== null) return null;
    const owningTeam = this.#database.findTeam(project.teamId);
    if (!owningTeam || owningTeam.organizationId !== input.organizationId) return null;
    if (!project.isPersonal && !owningTeam.isPersonal) return null;

    return { ownerUserId: owningTeam.ownerUserId };
  }

  /** The live row an update or an archive names, or the miss both answer with. */
  #live(id: string, organizationId: string): Project {
    const project = this.#database.findProject(id);
    if (
      !project ||
      project.archivedAt !== null ||
      !this.#database.isInOrganization(project, organizationId)
    ) {
      throw new ProjectNotFoundError("Project not found");
    }

    return project;
  }

  #touch(
    input: TouchCodingAgentActivityInput,
    column: "lastCodingAgentSessionAt" | "lastCodingAgentPullRequestAt",
  ): void {
    const project = this.#database.findProject(input.projectId);
    if (!project || project.archivedAt !== null) return;
    const seen = project[column];
    const stampedRecently = seen !== null && seen.getTime() > input.staleBefore.getTime();
    if (stampedRecently) return;
    this.#database.putProject({ ...project, [column]: input.at });
  }

  #identity(project: Project): ProjectIdentity | null {
    const team = this.#database.findTeam(project.teamId);
    if (!team) return null;

    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      teamId: project.teamId,
      organizationId: team.organizationId,
      isPersonal: project.isPersonal,
      ownerUserId: project.ownerUserId,
    };
  }

  #internal(project: Project): InternalProject {
    return internalProjectSchema.parse({
      id: project.id,
      name: project.name,
      slug: project.slug,
      teamId: project.teamId,
      kind: project.kind,
      archivedAtMs: project.archivedAt?.getTime() ?? null,
      traceSharingEnabled: project.traceSharingEnabled,
    });
  }

  #destination(project: Project): TraceDestinationProject {
    return traceDestinationProjectSchema.parse({
      id: project.id,
      teamId: project.teamId,
      apiKey: project.apiKey,
      archivedAt: project.archivedAt,
    });
  }

  /** A freshly inserted row, with the columns the database defaults. */
  #row(input: CreateProjectInput & Partial<Project>): Project {
    const now = toDate(nowInstant());

    return projectSchema.parse({
      lwqlKey: `lwql-${input.id}`,
      kind: PROJECT_KIND.APPLICATION,
      firstMessage: false,
      integrated: false,
      createdAt: now,
      updatedAt: now,
      userLinkTemplate: null,
      traceSharingEnabled: true,
      presenceEnabled: true,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      personalFeatures: {},
      departmentId: null,
      langyEgressAllowlist: null,
      lastCodingAgentSessionAt: null,
      lastCodingAgentPullRequestAt: null,
      ...input,
    });
  }
}
