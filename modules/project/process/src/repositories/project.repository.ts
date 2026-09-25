import type { OnboardingVariant } from "@langwatch/onboarding-contract";
import type {
  ActiveProjectsByScopesInput,
  CreateProjectInput,
  InternalProject,
  InternalProjectKind,
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
  ProjectUsageCount,
} from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

export type TouchCodingAgentActivityInput = {
  projectId: string;
  at: Instant;
  staleBefore: Instant;
};

export interface ProjectWithOrgAdmin {
  firstMessage: boolean;
  organizationId: string | null;
  adminUserId: string | null;
  /** Which onboarding the organization went through; null before the experiment. */
  onboardingVariant: OnboardingVariant | null;
  /** When the organization was created, for milestones measured in days since signup. */
  organizationCreatedAt: Instant | null;
}

/** Persistence owned by the Project module. It never crosses into a caller. */
export interface ProjectRepository {
  findPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
  findProjectsWithDepartments(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]>;
  assignProjectDepartment(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean>;
  findInternalByOrganization(organizationId: string): Promise<InternalProject | null>;
  findInternalBySlug(slug: string): Promise<InternalProject | null>;
  findLiveInternalIds(input: { kind: InternalProjectKind }): Promise<string[]>;
  createInternalOrFindWinner(input: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
  }): Promise<InternalProject>;
  isPresenceEnabled(projectId: string): Promise<boolean>;

  findById(id: string): Promise<Project | null>;
  findOrganizationId(projectId: string): Promise<string | undefined>;
  findWithTeam(id: string): Promise<ProjectWithTeam | null>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  touchCodingAgentSessionSeen(input: TouchCodingAgentActivityInput): Promise<void>;
  touchCodingAgentPullRequestSeen(input: TouchCodingAgentActivityInput): Promise<void>;
  findWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  findTraceSharingConfig(id: string): Promise<TraceSharingConfig | null>;
  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  create(input: CreateProjectInput): Promise<Project>;
  update(input: { id: string; organizationId: string; data: UpdateProjectInput }): Promise<Project>;
  archive(input: { id: string; organizationId: string }): Promise<Project>;
  listAllByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  findAllByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]>;
  findNamesByIds(projectIds: string[]): Promise<ProjectIdentity[]>;
  findIdentity(id: string): Promise<ProjectIdentity | null>;
  findIdsByOrganization(organizationId: string): Promise<string[]>;
  findLiveNonGovernanceIds(organizationId: string): Promise<string[]>;
  findLiveByIdInOrganization(input: { id: string; organizationId: string }): Promise<Project[]>;
  findLiveBySlugInOrganization(input: { slug: string; organizationId: string }): Promise<Project[]>;
  findActiveByScopes(input: ActiveProjectsByScopesInput): Promise<Project[]>;
  findBySlugInTeam(input: { slug: string; teamId: string }): Promise<Project | null>;
  findLiveTraceDestination(input: {
    organizationId: string;
    projectId: string;
  }): Promise<TraceDestinationProject | null>;
  findOldestGovernanceTraceDestination(
    organizationId: string,
  ): Promise<TraceDestinationProject | null>;
  countLiveNonGovernanceProjects(organizationId: string): Promise<number>;
  findTraceDestination(projectId: string): Promise<TraceDestinationProject | null>;
  findTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]>;
  /** The live project the legacy `apiKey` column names, or nothing. */
  findIdByLegacyApiKey(input: { token: string }): Promise<string | null>;
  /** False when no live row took the write, which is how the caller learns nothing rotated. */
  rotateLegacyApiKey(input: { projectId: string; token: string }): Promise<boolean>;
  /** Main `personal-team-scope.ts:90-97`: a personal project's owner, archived or not. */
  findPersonalProjectOwner(input: {
    organizationId: string;
    scopeId: string;
  }): Promise<{ ownerUserId: string | null } | null>;
  /** The usage report's counts; the caller never passes an empty organization list. */
  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<ProjectUsageCount>;
  countWithTraces(input: { organizationId: string }): Promise<number>;
  findSharedProjectSlugs(input: {
    organizationId: string;
    memberUserId?: string;
    limit: number;
  }): Promise<string[]>;
}
