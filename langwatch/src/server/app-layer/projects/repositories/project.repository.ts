import type { Project, Team } from "@prisma/client";

export type ProjectWithTeam = Project & { team: Team };

export type UpdateProjectMetadataInput = {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
};

export interface CreateProjectInput {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  apiKey: string;
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

export interface ProjectRepository {
  getById(id: string): Promise<Project | null>;
  getWithTeam(id: string): Promise<ProjectWithTeam | null>;
  updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void>;
  getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  /**
   * Returns the presence-enabled flags for a project + its org, or null when
   * the project doesn't exist. Using a dedicated select keeps the hot path
   * (every presence heartbeat) from pulling the full project row.
   */
  getPresenceConfig(id: string): Promise<PresenceConfig | null>;
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
  findAllByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Project>>;
  findBySlugInTeam(params: {
    slug: string;
    teamId: string;
  }): Promise<Project | null>;
  teamBelongsToOrganization(params: {
    teamId: string;
    organizationId: string;
  }): Promise<boolean>;
  findActiveTeamInOrganization(params: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string } | null>;
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

  async getWithTeam(_id: string): Promise<ProjectWithTeam | null> {
    return null;
  }

  async updateMetadata(_input: UpdateProjectMetadataInput): Promise<void> {
    // no-op
  }

  async getWithOrgAdmin(_id: string): Promise<ProjectWithOrgAdmin | null> {
    return null;
  }

  async getPresenceConfig(_id: string): Promise<PresenceConfig | null> {
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

  async findAllByOrganization(_params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Project>> {
    return { data: [], pagination: { page: 1, limit: 50, total: 0 } };
  }

  async findBySlugInTeam(_params: {
    slug: string;
    teamId: string;
  }): Promise<Project | null> {
    return null;
  }

  async teamBelongsToOrganization(_params: {
    teamId: string;
    organizationId: string;
  }): Promise<boolean> {
    return false;
  }

  async findActiveTeamInOrganization(_params: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string } | null> {
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
