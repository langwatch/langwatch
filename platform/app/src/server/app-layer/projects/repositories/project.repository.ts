import type { Project, Team } from "~/generated/prisma/client";
import type { OnboardingVariant } from "~/server/schemas/sign-up-data.schema";
import type { AggregateRule } from "../aggregate-rule";

export type ProjectWithTeam = Project & { team: Team };

export type UpdateProjectMetadataInput = {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
};

/**
 * One touch of a coding-agent recency column, under a staleness guard.
 *
 * `staleBefore` is what keeps the write rare. Both columns feed a recency
 * window measured in days, so recording the exact moment of every session and
 * every mapped pull request would buy nothing and cost one row update per fold
 * on a busy project. The caller names how stale the stored value has to be
 * before it is worth rewriting, and the repository does the whole decision in
 * the database: a row whose stored value is still newer than `staleBefore`
 * matches no filter and is not written at all.
 */
export type TouchCodingAgentActivityInput = {
  projectId: string;
  /** The moment being recorded. */
  at: Date;
  /** Write only when the stored value is null or at or before this. */
  staleBefore: Date;
};

export interface CreateProjectInput {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  apiKey: string;
  /** Omitted means the column default, `"application"`. */
  kind?: string;
  /** ADR-144: set only on an aggregate project. */
  aggregateRule?: AggregateRule;
}

export interface CreateTeamWithBindingInput {
  teamId: string;
  teamName: string;
  teamSlug: string;
  organizationId: string;
  roleBindingId: string;
  userId: string;
}

export interface UpdateProjectInput {
  name?: string;
  language?: string;
  framework?: string;
  teamId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
}

export interface ProjectWithOrgAdmin {
  firstMessage: boolean;
  organizationId: string | null;
  adminUserId: string | null;
  /** Which onboarding the organization went through; null before the experiment. */
  onboardingVariant: OnboardingVariant | null;
  /** When the organization was created, for milestones measured in days since signup. */
  organizationCreatedAt: Date | null;
}

export interface SearchProjectsResult {
  id: string;
  name: string;
  slug: string;
}

/**
 * Both flags as stored on the project's parent org and the project itself.
 * The caller decides how to combine them (typically: both must be true).
 */
export interface PresenceConfig {
  orgEnabled: boolean;
  projectEnabled: boolean;
}

/**
 * Trace-sharing kill switch as stored on the project's parent org and the
 * project itself. Effective sharing = org AND project (see ADR-057). Same shape
 * as {@link PresenceConfig} but kept separate so the two features can diverge.
 */
export interface TraceSharingConfig {
  orgEnabled: boolean;
  projectEnabled: boolean;
}

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
  getWithTeam(id: string): Promise<ProjectWithTeam | null>;
  updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void>;
  /**
   * Record that a coding-agent session was folded for this project, unless the
   * stored moment is still newer than `staleBefore`.
   */
  touchCodingAgentSessionSeen(
    input: TouchCodingAgentActivityInput,
  ): Promise<void>;
  /**
   * Record that a pull request was mapped for a branch a session in this
   * project ran on, under the same staleness guard.
   */
  touchCodingAgentPullRequestSeen(
    input: TouchCodingAgentActivityInput,
  ): Promise<void>;
  getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  /**
   * Returns the presence-enabled flags for a project + its org, or null when
   * the project doesn't exist. Using a dedicated select keeps the hot path
   * (every presence heartbeat) from pulling the full project row.
   */
  getPresenceConfig(id: string): Promise<PresenceConfig | null>;
  /**
   * Returns the trace-sharing flags for a project + its org, or null when the
   * project doesn't exist. Dedicated select so the share-create guard doesn't
   * pull the full project row. See ADR-057.
   */
  getTraceSharingConfig(id: string): Promise<TraceSharingConfig | null>;
  searchByQuery(params: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  create(data: CreateProjectInput): Promise<Project>;
  update(params: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project | null>;
  archive(params: {
    id: string;
    organizationId: string;
  }): Promise<Project | null>;
  /**
   * ADR-144 block E: replace a live aggregate's stored rule. Null when no live
   * aggregate of this organisation has the id; the caller has validated the
   * rule.
   */
  updateAggregateRule(params: {
    id: string;
    organizationId: string;
    aggregateRule: AggregateRule;
  }): Promise<Project | null>;
  /**
   * The slug of the project the app lands a member of an organisation on
   * when they chose none: their oldest unarchived project in it that is not
   * an aggregate (ADR-144 block F). Null when they have none.
   */
  findLandingProjectSlug(params: {
    organizationId: string;
    userId: string;
  }): Promise<string | null>;
  findAllByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
    /**
     * When set, restricts the listing (and its total) to these project ids —
     * the filtered listing a credential without organization-wide
     * `project:view` receives. An empty array lists nothing.
     */
    projectIds?: string[];
    /**
     * Leaves out the governance project always, and aggregate projects unless
     * the caller is an organisation admin (ADR-144 decision 5).
     */
    callerOrganizationRole: string | null;
  }): Promise<PaginatedResult<Project>>;
  /**
   * Every project id of the organization, ordered by id ascending: archived
   * ones and every kind INCLUDED. This is the tenant scope for reads keyed by
   * the traffic's own project (the gateway spend ledger), where a project
   * archived last month still has spend inside the window.
   */
  findAllIdsByOrganization(params: {
    organizationId: string;
  }): Promise<string[]>;
  findBySlugInTeam(params: {
    slug: string;
    teamId: string;
  }): Promise<Project | null>;
  /**
   * The unarchived projects of one team of the organisation, with their
   * kind: what archiving the team takes out of every aggregate (ADR-144
   * block E). Empty for a team of another organisation.
   */
  findLiveKindsByTeam(params: {
    teamId: string;
    organizationId: string;
  }): Promise<Pick<Project, "id" | "kind">[]>;
  findActiveTeamInOrganization(params: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null>;
  createTeamWithRoleBinding(
    input: CreateTeamWithBindingInput,
  ): Promise<{ id: string }>;
  createTeam(input: {
    teamId: string;
    teamName: string;
    teamSlug: string;
    organizationId: string;
  }): Promise<{ id: string }>;
}

export class NullProjectRepository implements ProjectRepository {
  async getById(_id: string): Promise<Project | null> {
    return null;
  }

  async findLandingProjectSlug(_params: {
    organizationId: string;
    userId: string;
  }): Promise<string | null> {
    return null;
  }

  async getWithTeam(_id: string): Promise<ProjectWithTeam | null> {
    return null;
  }

  async updateMetadata(_input: UpdateProjectMetadataInput): Promise<void> {
    // no-op
  }

  async touchCodingAgentSessionSeen(
    _input: TouchCodingAgentActivityInput,
  ): Promise<void> {
    // no-op
  }

  async touchCodingAgentPullRequestSeen(
    _input: TouchCodingAgentActivityInput,
  ): Promise<void> {
    // no-op
  }

  async getWithOrgAdmin(_id: string): Promise<ProjectWithOrgAdmin | null> {
    return null;
  }

  async getPresenceConfig(_id: string): Promise<PresenceConfig | null> {
    return null;
  }

  async getTraceSharingConfig(_id: string): Promise<TraceSharingConfig | null> {
    return null;
  }

  async searchByQuery(_params: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return [];
  }

  async create(_data: CreateProjectInput): Promise<Project> {
    throw new Error("NullProjectRepository.create not implemented");
  }

  async update(_params: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project | null> {
    return null;
  }

  async archive(_params: {
    id: string;
    organizationId: string;
  }): Promise<Project | null> {
    return null;
  }

  async updateAggregateRule(_params: {
    id: string;
    organizationId: string;
    aggregateRule: AggregateRule;
  }): Promise<Project | null> {
    return null;
  }

  async findAllByOrganization(_params: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
    callerOrganizationRole: string | null;
  }): Promise<PaginatedResult<Project>> {
    return { data: [], pagination: { page: 1, limit: 50, total: 0 } };
  }

  async findAllIdsByOrganization(_params: {
    organizationId: string;
  }): Promise<string[]> {
    return [];
  }

  async findLiveKindsByTeam(_params: {
    teamId: string;
    organizationId: string;
  }): Promise<Pick<Project, "id" | "kind">[]> {
    return [];
  }

  async findBySlugInTeam(_params: {
    slug: string;
    teamId: string;
  }): Promise<Project | null> {
    return null;
  }

  async findActiveTeamInOrganization(_params: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null> {
    return null;
  }

  async createTeamWithRoleBinding(
    _input: CreateTeamWithBindingInput,
  ): Promise<{ id: string }> {
    throw new Error(
      "NullProjectRepository.createTeamWithRoleBinding not implemented",
    );
  }

  async createTeam(_input: {
    teamId: string;
    teamName: string;
    teamSlug: string;
    organizationId: string;
  }): Promise<{ id: string }> {
    throw new Error("NullProjectRepository.createTeam not implemented");
  }
}
