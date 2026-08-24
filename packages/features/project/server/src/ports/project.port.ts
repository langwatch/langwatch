import type {
  ActiveProjectsByScopesInput,
  CreateProjectInput,
  InternalProject,
  PaginatedProjects,
  Project,
  ProjectWithTeam,
  SearchProjectsResult,
  TraceSharingConfig,
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

/** Structural database capability accepted by the composition adapter. */
export interface ProjectDatabase {
  readonly project: object;
  readonly team: object;
}

/** Persistence owned by the Project feature. It never crosses into a caller. */
export abstract class ProjectRepository {
  abstract tryFindInternalByOrganization(
    organizationId: string,
  ): Promise<InternalProject | null>;
  abstract tryFindInternalBySlug(slug: string): Promise<InternalProject | null>;
  abstract createInternalOrFindWinner(input: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
  }): Promise<InternalProject>;
  abstract isPresenceEnabled(projectId: string): Promise<boolean>;

  abstract tryGetById(id: string): Promise<Project | null>;
  abstract tryGetWithTeam(id: string): Promise<ProjectWithTeam | null>;
  abstract tryGetWithTeamByLegacyApiKey(
    apiKey: string,
  ): Promise<ProjectWithTeam | null>;
  abstract updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  abstract touchCodingAgentSessionSeen(
    input: TouchCodingAgentActivityInput,
  ): Promise<void>;
  abstract touchCodingAgentPullRequestSeen(
    input: TouchCodingAgentActivityInput,
  ): Promise<void>;
  abstract tryGetWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null>;
  abstract tryGetTraceSharingConfig(id: string): Promise<TraceSharingConfig | null>;
  abstract searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]>;
  abstract create(input: CreateProjectInput): Promise<Project>;
  abstract update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project>;
  abstract archive(input: {
    id: string;
    organizationId: string;
  }): Promise<Project>;
  abstract findAllByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects>;
  abstract findAllByTeam(input: {
    organizationId: string;
    teamId: string;
  }): Promise<Project[]>;
  abstract findActiveByScopes(
    input: ActiveProjectsByScopesInput,
  ): Promise<Project[]>;
  abstract tryFindBySlugInTeam(input: {
    slug: string;
    teamId: string;
  }): Promise<Project | null>;
  abstract tryFindActiveTeamInOrganization(input: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null>;
  abstract regenerateApiKey(projectId: string, apiKey: string): Promise<string>;
}

export abstract class ProjectCredentialsPort {
  abstract generateProjectId(): string;
  abstract generateApiKey(): string;
}

export abstract class ProjectKeyMapPort {
  abstract syncProject(input: {
    projectId: string;
    lwqlKey: string;
  }): Promise<void>;
}

export abstract class ProjectStoredObjectsPort {
  abstract deleteOwnedBy(input: { projectId: string }): Promise<void>;
}

export abstract class ProjectDiagnosticsPort {
  abstract error(
    context: Record<string, unknown>,
    message: string,
  ): void;
  abstract capture(error: Error, context: Record<string, unknown>): void;
}
