import { moduleApi } from "@langwatch/module";
import type { Instant } from "@langwatch/time";

import type {
  AggregateMemberCandidate,
  AggregateRule,
  LiveAggregate,
  StoredAggregateProject,
} from "./project.aggregate-rule.ts";
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
  LiveProjectIdsByOrganizationInput,
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
  ProjectKind,
} from "./project.ts";

export type ProjectPath = { projectId: string; fullPath: string };

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * projects made, since `since` where one is given, the projects
 * changed since then, and when the first project was. Epoch milliseconds.
 */
export interface ProjectUsageCount {
  readonly projects: number;
  readonly updatedProjects: number;
  readonly firstProjectAt?: number;
}

export interface ProjectIdPageInput {
  after?: string | undefined;
  limit?: number | undefined;
}

export interface ProjectIdPage {
  ids: string[];
  next: string | null;
}

/** A project and the organisation that owns it, as fleet scans read them. */
export interface ProjectOrganizationRef {
  id: string;
  organizationId: string;
}

export interface ProjectOrganizationPage {
  projects: ProjectOrganizationRef[];
  next: string | null;
}

/** A project and its LangWatchQL key, as the key-map backfill reads them. */
export interface ProjectLwqlKey {
  id: string;
  lwqlKey: string;
}

export interface ProjectLwqlKeyPage {
  projects: ProjectLwqlKey[];
  next: string | null;
}

/** A project and whether it names its own S3 bucket, as the storage migration reads it. */
export interface ProjectPrivateS3 {
  id: string;
  privateS3: boolean;
}

export interface ProjectPrivateS3Page {
  projects: ProjectPrivateS3[];
  next: string | null;
}

/** The page size fleet scans pass to `listAllIds`. */
export const PROJECT_ID_PAGE_LIMIT = 500;

export interface ProjectApi {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
  /**
   * Every non-governance project with its department, less `hiddenKinds` (main
   * `department.service.ts:126-133`; callers pass `projectKindsHiddenFrom(role)`).
   */
  findProjectsWithDepartments(input: {
    organizationId: string;
    hiddenKinds: readonly string[];
  }): Promise<{ id: string; name: string; departmentId: string | null }[]>;
  /**
   * Points one project at a department, or clears it; false when no such project (main
   * `department.service.ts:334-352`).
   */
  assignProjectDepartment(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean>;
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
    /** The organization's hidden governance project is left out unless this is true. */
    includeGovernance?: boolean;
    /** Kinds left out as well, e.g. `projectKindsHiddenFrom(role)` for a non-admin caller. */
    hiddenKinds?: ProjectKind[];
  }): Promise<PaginatedProjects>;
  listByTeam(input: {
    organizationId: string;
    teamId: string;
    /** The organization's hidden governance project is left out unless this is true. */
    includeGovernance?: boolean;
  }): Promise<Project[]>;
  listNamesByIds(input: ProjectNamesByIdsInput): Promise<ProjectIdentity[]>;
  listIdsByOrganization(input: ProjectIdsByOrganizationInput): Promise<string[]>;
  /** Unarchived, non-governance project ids, unpaged: main's `findAllByOrganization` filter. */
  findLiveNonGovernanceIdsByOrganization(
    input: LiveProjectIdsByOrganizationInput,
  ): Promise<string[]>;
  /** Main's CLI project-key read (auth-cli.ts:2092): a live project by slug, in one org. */
  findLiveBySlug(input: Readonly<{ slug: string; organizationId: string }>): Promise<Project[]>;
  /** Main's `findProjectInOrg` (auth-cli.ts:2533): a live project by id, else slug, in one org. */
  findLiveByRef(
    input: Readonly<{ projectRef: string; organizationId: string }>,
  ): Promise<Project[]>;
  create(
    input: Readonly<{
      organizationId: string;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
      /** ADR-177: `"aggregate"` reads its members through grants; organisation admins only. */
      kind?: "application" | "aggregate" | undefined;
      /** Only read for an aggregate; defaults to `AGGREGATE_DEFAULT_RULE`. */
      aggregateRule?: AggregateRule | undefined;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project>;
  /**
   * Provisions a project for a management credential, which may be a service
   * key acting as nobody: the actor is nullable here, unlike `create`'s.
   */
  createInOrganization(
    input: Readonly<{
      organizationId: string;
      userId: string | null;
      teamId?: string | undefined;
      newTeamName?: string | undefined;
      name: string;
      language: string;
      framework: string;
    }>,
  ): Promise<Project>;
  /**
   * Stored-object credentials (`s3Endpoint`, `s3AccessKeyId`, `s3SecretAccessKey`)
   * arrive as plaintext and are sealed on write; reads answer them as stored.
   */
  updateSettings(
    input: Readonly<UpdateProjectInput & { projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project>;
  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }>;
  /** The live project a legacy `apiKey` column names, or nothing. */
  findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null>;
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
  /** Live application projects that have received a trace; internal projects excluded. */
  countWithTraces(input: { organizationId: string }): Promise<number>;
  /** Live shared-team projects, oldest first; with a member, only theirs (main `resolveHome`). */
  findSharedProjectSlugs(input: {
    organizationId: string;
    memberUserId?: string;
    limit: number;
  }): Promise<string[]>;
  /**
   * Project ids on this install ordered by id, archived included, a page at a time
   * for fleet-wide scans. No limit reads them all; `next` is null on the last page.
   */
  listAllIds(input?: ProjectIdPageInput): Promise<ProjectIdPage>;
  /**
   * Every project with its organisation, paged like `listAllIds`, for the storage
   * migration inventory (main `migrateObjectStorage.ts` `listProjectsPage`).
   */
  listAllWithOrganization(input?: ProjectIdPageInput): Promise<ProjectOrganizationPage>;
  /**
   * Every project with whether it names its own S3 bucket, paged like `listAllIds`, for the
   * object-storage migration inventory: a global provider move leaves those projects out.
   */
  listAllWithPrivateS3(input?: ProjectIdPageInput): Promise<ProjectPrivateS3Page>;
  /** Every project with its LangWatchQL key, paged like `listAllIds`, for the key-map backfill. */
  listLwqlKeys(input?: ProjectIdPageInput): Promise<ProjectLwqlKeyPage>;
  /** ADR-177: the aggregate with this id, or nothing when no aggregate project has it. */
  findAggregate(input: { aggregateProjectId: string }): Promise<StoredAggregateProject[]>;
  /** ADR-177: the organisation's live aggregates, ordered by id. */
  findLiveAggregateIds(input: { organizationId: string }): Promise<string[]>;
  /** ADR-177: every live aggregate in every organisation, ordered by id, for the sweep. */
  findAllLiveAggregates(): Promise<LiveAggregate[]>;
  /**
   * ADR-177: live personal projects an aggregate may read, ordered by id; with
   * `ownerUserIds`, only theirs (governance resolves a department to its members).
   */
  findPersonalProjectIds(input: {
    organizationId: string;
    ownerUserIds?: readonly string[];
  }): Promise<string[]>;
  /** ADR-177: of `projectIds`, the live ones of this organisation an aggregate may read. */
  findReadableProjectIds(input: {
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<string[]>;
  /** ADR-177: every project an explicit rule may name, with its owner, ordered by name. */
  findCandidateMembers(input: { organizationId: string }): Promise<AggregateMemberCandidate[]>;
}

export const ProjectApi = moduleApi<ProjectApi>()("project");

/** The inline command palette project lends by token to a landing hero (§10, §10.1). */

/** What a landing hero hands project's lent inline command palette. */
export type HeroAskFieldProps = { placeholder: string };

/** Main's project selector, lent by project to pages outside the navigation shell (§10, §10.1). */

/** The switcher needs nothing handed in: it reads the scope and the graph itself. */
export type ProjectSwitcherProps = Record<string, never>;
