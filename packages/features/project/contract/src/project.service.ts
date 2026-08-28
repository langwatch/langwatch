import type {
  ActiveProjectsByScopes,
  ActiveProjectsByScopesInput,
  InternalProject,
  InternalProjectQuery,
  OrgAdminResolution,
  PaginatedProjects,
  Project,
  ProjectIdentity,
  ProjectIdsByOrganizationInput,
  ProjectNamesByIdsInput,
  ProjectWithTeam,
  ProjectPresenceInput,
  SearchProjectsResult,
  TraceSharingConfig,
  TraceDestinationDecision,
  TraceDestinationInput,
  TraceDestinationProject,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "./project";

export abstract class ProjectService {
  abstract tryFindInternal(input: InternalProjectQuery): Promise<InternalProject | null>;

  abstract ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;

  /** Answers the effective organization-and-project presence policy. */
  abstract isPresenceEnabled(input: ProjectPresenceInput): Promise<boolean>;

  abstract getById(id: string): Promise<Project>;
  /**
   * Reads only who the project is — the value a request boundary carries.
   *
   * Five indexed columns and no team row, because this runs once per
   * authenticated request. Absent when the project does not exist.
   */
  abstract tryGetIdentity(id: string): Promise<ProjectIdentity | null>;
  /** Returns the owning organization or throws when the project does not exist. */
  abstract getOrganizationId(projectId: string): Promise<string>;
  /** Compatibility tenant lookup; unknown or orphaned projects are absent. */
  abstract tryGetOrganizationId(projectId: string): Promise<string | undefined>;
  abstract tryGetById(id: string): Promise<Project | null>;
  /** Compatibility identity read used by legacy automation handlers. */
  abstract tryGetSummaryById(projectId: string): Promise<{ name: string; slug: string } | null>;
  abstract getWithTeam(id: string): Promise<ProjectWithTeam>;
  abstract tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  abstract create(input: {
    organizationId: string;
    userId?: string | null;
    teamId?: string;
    newTeamName?: string;
    name: string;
    language: string;
    framework: string;
  }): Promise<Project>;
  abstract update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project>;
  abstract archive(input: { id: string; organizationId: string }): Promise<Project>;
  abstract listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  abstract listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]>;
  abstract listNamesByIds(input: ProjectNamesByIdsInput): Promise<ProjectIdentity[]>;
  /** Includes archived projects because durable spend remains attributable to them. */
  abstract listIdsByOrganization(input: ProjectIdsByOrganizationInput): Promise<string[]>;
  /** Lists active projects reached by the supplied organization/team/project scopes. */
  abstract listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes>;
  abstract updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  abstract touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void>;
  abstract touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void>;
  abstract searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  abstract tryGetTraceSharingConfig(projectId: string): Promise<TraceSharingConfig | null>;
  abstract resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
  abstract resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision>;
  /** Follows a stored Gateway trace-destination pointer, including archived projects. */
  abstract tryGetTraceDestination(projectId: string): Promise<TraceDestinationProject | null>;
  /** Batch counterpart for Gateway listings; unknown ids are omitted. */
  abstract listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]>;
}
