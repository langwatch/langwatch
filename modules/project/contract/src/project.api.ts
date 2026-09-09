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
  SearchProjectsResult,
  TraceDestinationDecision,
  TraceDestinationInput,
  TraceDestinationProject,
  TraceSharingConfig,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "./project.ts";
import type { TopicClusteringRequest } from "./project.responses.ts";
import { moduleApi } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";

export type ProjectPath = { projectId: string; fullPath: string };

export interface ProjectApi {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
  tryGetOrganizationId(projectId: string): Promise<string | undefined>;
  isPresenceEnabled(input: { projectId: string }): Promise<boolean>;
  tryGetSummaryById(projectId: string): Promise<{ name: string; slug: string } | null>;
  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  tryGetById(id: string): Promise<Project | null>;
  getOrganizationId(projectId: string): Promise<string>;
  getWithTeam(id: string): Promise<ProjectWithTeam>;
  tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]>;
  listNamesByIds(input: ProjectNamesByIdsInput): Promise<ProjectIdentity[]>;
  listIdsByOrganization(input: ProjectIdsByOrganizationInput): Promise<string[]>;
  create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project>;
  updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project>;
  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }>;
  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string>;
  /** The live project a legacy `apiKey` column names, or nothing. */
  findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null>;
  /**
   * Writes a new legacy key onto a live project. False when there is no live
   * row to write it to, which is how the caller knows nothing was rotated.
   */
  rotateLegacyApiKey(input: Readonly<{ projectId: string; token: string }>): Promise<boolean>;
  /**
   * Whether the organisation and the project both still allow trace sharing.
   * Nothing when the project is not there to read the two switches from.
   */
  findTraceSharingConfig(
    input: Readonly<{ projectId: string }>,
  ): Promise<TraceSharingConfig | null>;
  /**
   * Whose personal workspace a scope is: the team's own owner, or the owner of
   * the team a personal project hangs from. Nothing when the scope is shared.
   */
  findPersonalWorkspaceOwner(
    input: Readonly<{ organizationId: string; scopeId: string }>,
  ): Promise<{ ownerUserId: string | null } | null>;
  requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<TopicClusteringRequest>;
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void>;
  /** Stamps a project as having just seen coding-agent session activity. */
  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
  /** The organisation's internal governance project, or nothing when it has none. */
  findInternal(input: InternalProjectQuery): Promise<InternalProject | null>;
  /** The organisation's internal governance project, created on first ask. */
  ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
  /**
   * Reads only who the project is, the value a request boundary carries.
   *
   * Five indexed columns and no team row, because this runs once per
   * authenticated request. Absent when the project does not exist.
   */
  findIdentity(id: string): Promise<ProjectIdentity | null>;
  /** Lists active projects reached by the supplied organisation/team/project scopes. */
  listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  /** The organisation and its first admin, as an ingested trace resolves them. */
  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
  /** Where a Gateway call's traces land, given the key's own project. */
  resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision>;
  /** Follows a stored Gateway trace-destination pointer, including archived projects. */
  findTraceDestination(projectId: string): Promise<TraceDestinationProject | null>;
  /** Batch counterpart for Gateway listings; unknown ids are omitted. */
  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]>;
}

export const ProjectApi = moduleApi<ProjectApi>("project");
