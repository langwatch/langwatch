import type {
  ActiveProjectsByScopesInput,
  CreateProjectInput,
  InternalProject,
  PaginatedProjects,
  Project,
  ProjectIdentity,
  ProjectPath,
  ProjectWithTeam,
  SearchProjectsResult,
  TraceSharingConfig,
  TraceDestinationProject,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "@langwatch/project-contract";

export type TouchCodingAgentActivityInput = {
  projectId: string;
  at: Date;
  staleBefore: Date;
};

export interface ProjectWithOrgAdmin {
  firstMessage: boolean;
  organizationId: string | null;
  adminUserId: string | null;
}

/** Persistence owned by the Project module. It never crosses into a caller. */
export interface ProjectRepository {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
  tryFindInternalByOrganization(organizationId: string): Promise<InternalProject | null>;
  tryFindInternalBySlug(slug: string): Promise<InternalProject | null>;
  createInternalOrFindWinner(input: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
  }): Promise<InternalProject>;
  isPresenceEnabled(projectId: string): Promise<boolean>;

  tryGetById(id: string): Promise<Project | null>;
  tryGetOrganizationId(projectId: string): Promise<string | undefined>;
  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  touchCodingAgentSessionSeen(input: TouchCodingAgentActivityInput): Promise<void>;
  touchCodingAgentPullRequestSeen(input: TouchCodingAgentActivityInput): Promise<void>;
  tryGetWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  findTraceSharingConfig(id: string): Promise<TraceSharingConfig | null>;
  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  create(input: CreateProjectInput): Promise<Project>;
  update(input: { id: string; organizationId: string; data: UpdateProjectInput }): Promise<Project>;
  archive(input: { id: string; organizationId: string }): Promise<Project>;
  findAllByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  findAllByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]>;
  findNamesByIds(projectIds: string[]): Promise<ProjectIdentity[]>;
  tryFindIdentity(id: string): Promise<ProjectIdentity | null>;
  findIdsByOrganization(organizationId: string): Promise<string[]>;
  findActiveByScopes(input: ActiveProjectsByScopesInput): Promise<Project[]>;
  tryFindBySlugInTeam(input: { slug: string; teamId: string }): Promise<Project | null>;
  tryFindActiveTeamInOrganization(input: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null>;
  tryFindLiveTraceDestination(input: {
    organizationId: string;
    projectId: string;
  }): Promise<TraceDestinationProject | null>;
  tryFindOldestGovernanceTraceDestination(
    organizationId: string,
  ): Promise<TraceDestinationProject | null>;
  countLiveNonGovernanceProjects(organizationId: string): Promise<number>;
  tryGetTraceDestination(projectId: string): Promise<TraceDestinationProject | null>;
  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]>;
  /** The live project the legacy `apiKey` column names, or nothing. */
  findIdByLegacyApiKey(input: { token: string }): Promise<string | null>;
  /** False when no live row took the write, which is how the caller learns nothing rotated. */
  rotateLegacyApiKey(input: { projectId: string; token: string }): Promise<boolean>;
  /** Resolves personal team/project ownership for a caller that owns neither table. */
  findPersonalWorkspaceOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
}
