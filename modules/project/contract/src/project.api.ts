import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type { TopicClusteringRequest } from "./project.responses.ts";
import type {
  ActiveProjectsByScopes,
  ActiveProjectsByScopesInput,
  InternalProject,
  InternalProjectKind,
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

export type ProjectPath = { projectId: string; fullPath: string };

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * projects and teams made, since `since` where one is given, the projects
 * changed since then, and when the first project was. Epoch milliseconds.
 */
export interface ProjectUsageCount {
  readonly projects: number;
  readonly teams: number;
  readonly updatedProjects: number;
  readonly firstProjectAt?: number;
}

export interface ProjectApi {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
  findOrganizationId(projectId: string): Promise<string | undefined>;
  isPresenceEnabled(input: { projectId: string }): Promise<boolean>;
  findSummaryById(projectId: string): Promise<{ name: string; slug: string } | null>;
  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  findById(id: string): Promise<Project | null>;
  getOrganizationId(projectId: string): Promise<string>;
  getWithTeam(id: string): Promise<ProjectWithTeam>;
  findWithTeam(id: string): Promise<ProjectWithTeam | null>;
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
  /** Every live internal project of this kind, across organisations: its id only. */
  findInternalIds(input: { kind: InternalProjectKind }): Promise<string[]>;
  /**
   * Reads only who the project is — five indexed columns, no team row,
   * because this runs once per authenticated request. Absent when missing.
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
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<ProjectUsageCount>;
}

export const ProjectApi = moduleApi<ProjectApi>()("project");
