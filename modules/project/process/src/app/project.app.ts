import { ApiKeyApi, type ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi, type AuthzPermission } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { LangyApi } from "@langwatch/langy-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type ActiveProjectsByScopes,
  type ActiveProjectsByScopesInput,
  type InternalProject,
  type InternalProjectQuery,
  type OrgAdminResolution,
  type Project,
  type ProjectIdentity,
  type ProjectWithTeam,
  type PaginatedProjects,
  type TopicClusteringRequest,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
  type TraceSharingConfig,
  type UpdateProjectInput,
  type UpdateProjectMetadataInput,
  type ProjectUsageCount,
  type ProjectPath,
  type SearchProjectsResult,
} from "@langwatch/project-contract";
import type * as projectContractModule from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { TopicApi } from "@langwatch/topic-contract";
import { TraceApi } from "@langwatch/trace-contract";

import type { ProjectRepositories } from "../repositories/project.repositories.ts";
import { ProjectCredentialsService } from "../services/project-credentials.service.ts";
import { ProjectOperationsService } from "../services/project-operations.service.ts";
import { ProjectService as ProjectApplicationService } from "../services/project.service.ts";
import type { ProjectManagementApi } from "../transport/project.rest.ts";
import type {
  ProjectBrowserApi,
  ProjectFieldProtections,
  ProjectPermissionScope,
} from "../transport/project.trpc.ts";

export type ProjectInfrastructure = Readonly<{
  now?: (() => number) | undefined;
}>;

/**
 * The two process members this application reads, from the closed fourteen-name
 * vocabulary. Their shapes are restated rather than imported from
 * `@langwatch/process-stores`: a module depends on contracts.
 */
type ProjectProcessMembers = Readonly<{
  /** The deployment's symmetric cipher, for the stored-object credentials. */
  encryption: Readonly<{ encrypt(plaintext: string): string }>;
  /** Where a best-effort failure is reported when nothing can be done about it. */
  logger: Readonly<{
    error(payload: Readonly<Record<string, unknown>>, message: string): void;
  }>;
}>;

type ProjectDependencies = Readonly<{
  organizations: typeof OrganizationApi;
  apiKeys: typeof ApiKeyApi;
  share: typeof ShareApi;
  topics: typeof TopicApi;
  /**
   * Asked about a scope the door's declared check did not resolve. Every
   * process that installs this module installs AuthZ, which is what makes it
   * a dependency rather than an answer the door has to carry in.
   */
  authorization: typeof AuthzApi;
  trace: typeof TraceApi;
  auditLog: typeof AuditLogApi;
  langy: typeof LangyApi;
}>;
type ProjectSetup = FeatureSetup<
  ProjectDependencies,
  ProjectInfrastructure & ProjectProcessMembers,
  undefined,
  ProjectRepositories
>;

/**
 * The project application: what peer modules, `/api/projects` and the browser
 * door each call, handed through the operations-only proxy — an unserved
 * member throws at first request, which `implements` turns into a build failure.
 */
export class ProjectApp implements ProjectApiContract, ProjectManagementApi, ProjectBrowserApi {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]> {
    return this.#projectService.listPaths(input);
  }

  static readonly contract = ProjectApi;
  static readonly dependencies: ProjectDependencies = {
    organizations: OrganizationApi,
    apiKeys: ApiKeyApi,
    share: ShareApi,
    topics: TopicApi,
    authorization: AuthzApi,
    trace: TraceApi,
    auditLog: AuditLogApi,
    langy: LangyApi,
  };
  /** Both names are from the process's vocabulary; boot refuses by name. */
  static readonly reads = ["encryption", "logger"] as const;

  readonly #projectService: ProjectApplicationService;
  readonly #operations: ProjectOperationsService;
  readonly #apiKeys: ApiKeyApi;
  readonly #authorization: AuthzApi;
  readonly #trace: TraceApi;
  readonly #langy: LangyApi;
  readonly #encryption: ProjectProcessMembers["encryption"];
  readonly #logger: ProjectProcessMembers["logger"];
  private constructor({
    projectService,
    operations,
    apiKeys,
    authorization,
    trace,
    langy,
    encryption,
    logger,
  }: {
    projectService: ProjectApplicationService;
    operations: ProjectOperationsService;
    apiKeys: ApiKeyApi;
    authorization: AuthzApi;
    trace: TraceApi;
    langy: LangyApi;
    encryption: ProjectProcessMembers["encryption"];
    logger: ProjectProcessMembers["logger"];
  }) {
    this.#projectService = projectService;
    this.#operations = operations;
    this.#apiKeys = apiKeys;
    this.#authorization = authorization;
    this.#trace = trace;
    this.#langy = langy;
    this.#encryption = encryption;
    this.#logger = logger;
  }

  static create({ members, dependencies, repositories }: ProjectSetup): ProjectApp {
    const projects = ProjectApplicationService.create({
      repository: repositories.projects,
      credentials: ProjectCredentialsService.create(),
      organizations: dependencies.organizations,
    });
    const operations = ProjectOperationsService.create({
      projects,
      apiKeys: dependencies.apiKeys,
      share: dependencies.share,
      topics: dependencies.topics,
      now: members.now ?? (() => nowInstant().epochMilliseconds),
      auditLog: dependencies.auditLog,
      logger: members.logger,
    });
    return new ProjectApp({
      projectService: projects,
      operations,
      apiKeys: dependencies.apiKeys,
      authorization: dependencies.authorization,
      trace: dependencies.trace,
      langy: dependencies.langy,
      encryption: members.encryption,
      logger: members.logger,
    });
  }

  /**
   * This module's own application, as the browser door reaches it: the door
   * holds one reference, so the project reads its procedures make and the
   * deployment answers they need arrive through the same object.
   */
  projects(): ProjectApiContract {
    return this;
  }

  /** The deployment's cipher, for the stored-object credentials on the form. */
  encryptProjectSecret(value: string): string {
    return this.#encryption.encrypt(value);
  }

  /**
   * Whether `by` holds `permission` at a scope the door's check did not
   * resolve. `by` is an argument because this is the process's one instance —
   * reading a "current user" from anywhere else would answer for whoever asked last.
   */
  probePermission(input: {
    permission: AuthzPermission;
    scope: ProjectPermissionScope;
    by: Readonly<{ id: string }>;
  }): Promise<boolean> {
    const { permission, scope, by } = input;

    switch (scope.tier) {
      case "project":
        return this.#authorization.hasPermission({
          userId: by.id,
          permission,
          projectId: scope.id,
        });
      case "team":
        return this.#authorization.hasPermission({ userId: by.id, permission, teamId: scope.id });
      case "organization":
        return this.#authorization.hasPermission({
          userId: by.id,
          permission,
          organizationId: scope.id,
        });
    }
  }

  /** `by`'s captured-content visibility, as the trace module resolves it for a viewer. */
  getFieldProtections(input: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<ProjectFieldProtections> {
    return this.#trace.resolveViewerProtections({
      projectId: input.projectId,
      userId: input.by.id,
    });
  }

  provisionLangyVirtualKey(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void> {
    return this.#langy.provisionVirtualKey(input);
  }

  recordApiKeyRegenerated(entry: { userId: string; projectId: string }): Promise<void> {
    return this.#operations.recordApiKeyRegenerated(entry);
  }

  /**
   * A clustering request that did not land. Reported rather than raised: the
   * door has already decided this is best effort, and the topic module
   * re-schedules on its own.
   */
  reportTopicClusteringFailure(error: unknown, context: { projectId: string }): void {
    this.#logger.error({ error, projectId: context.projectId }, "Topic clustering request failed.");
  }

  /**
   * The `/api/projects` management operations, each scoped to the
   * organization the door's credential resolved — never the project itself —
   * so a token issued for one organization cannot reach another's project.
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
  ): Promise<Project> {
    return this.#projectService.create({
      organizationId: input.organizationId,
      userId: input.userId,
      teamId: input.teamId,
      newTeamName: input.newTeamName,
      name: input.name,
      language: input.language,
      framework: input.framework,
    });
  }

  updateInOrganization(
    input: Readonly<{ projectId: string; organizationId: string; data: UpdateProjectInput }>,
  ): Promise<Project> {
    return this.#projectService.update({
      id: input.projectId,
      organizationId: input.organizationId,
      data: input.data,
    });
  }

  archiveInOrganization(
    input: Readonly<{ projectId: string; organizationId: string }>,
  ): Promise<Project> {
    return this.#projectService.archive({
      id: input.projectId,
      organizationId: input.organizationId,
    });
  }

  resolveVisibleProjects(
    input: Readonly<{ apiKeyId: string; organizationId: string }>,
  ): Promise<ApiKeyVisibleProjects> {
    return this.#apiKeys.resolveVisibleProjects(input);
  }

  /**
   * The service key a newly provisioned project is handed back with: an
   * organization key bound as ADMIN on that project alone, belonging to no
   * member. Lives here because it is what a project's credential IS, not how one door spells it.
   */
  async provisionServiceKey(
    input: Readonly<{
      projectId: string;
      projectName: string;
      organizationId: string;
      createdByUserId: string | null;
    }>,
  ): Promise<{ token: string; apiKeyId: string }> {
    const created = await this.#apiKeys.create({
      name: `${input.projectName} Service Key`,
      userId: null,
      createdByUserId: input.createdByUserId,
      organizationId: input.organizationId,
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: input.projectId }],
    });

    return { token: created.token, apiKeyId: created.apiKey.id };
  }

  isPresenceEnabled(input: { projectId: string }): Promise<boolean> {
    return this.#projectService.isPresenceEnabled(input);
  }

  findOrganizationId(projectId: string): Promise<string | undefined> {
    return this.#projectService.findOrganizationId(projectId);
  }

  findSummaryById(projectId: string): Promise<{ name: string; slug: string } | null> {
    return this.#projectService.findSummaryById(projectId);
  }

  searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    return this.#projectService.searchByQuery(input);
  }

  findById(id: string): Promise<Project | null> {
    return this.#projectService.findById(id);
  }

  getOrganizationId(projectId: string): Promise<string> {
    return this.#projectService.getOrganizationId(projectId);
  }

  getWithTeam(id: string): Promise<ProjectWithTeam> {
    return this.#projectService.getWithTeam(id);
  }

  findWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.#projectService.findWithTeam(id);
  }

  listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    return this.#projectService.listByOrganization(input);
  }

  listByTeam(input: { organizationId: string; teamId: string }): Promise<Project[]> {
    return this.#projectService.listByTeam(input);
  }

  listNamesByIds(input: projectContractModule.ProjectNamesByIdsInput): Promise<ProjectIdentity[]> {
    return this.#projectService.listNamesByIds(input);
  }

  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<ProjectUsageCount> {
    return this.#projectService.countUsage(input);
  }

  listIdsByOrganization(
    input: projectContractModule.ProjectIdsByOrganizationInput,
  ): Promise<string[]> {
    return this.#projectService.listIdsByOrganization(input);
  }

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
  ): Promise<Project> {
    return this.#operations.create(input, by);
  }

  updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>): Promise<Project> {
    return this.#operations.updateSettings(input);
  }

  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    return this.#operations.archive(input);
  }

  regenerateLegacyProjectKey(input: Readonly<{ projectId: string }>): Promise<string> {
    return this.#operations.regenerateLegacyProjectKey(input);
  }

  findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null> {
    return this.#projectService.findIdByLegacyApiKey(input);
  }

  rotateLegacyApiKey(input: Readonly<{ projectId: string; token: string }>): Promise<boolean> {
    return this.#projectService.rotateLegacyApiKey(input);
  }

  /** Both kill switches a trace share is minted under, read off this module's rows. */
  findTraceSharingConfig(
    input: Readonly<{ projectId: string }>,
  ): Promise<TraceSharingConfig | null> {
    return this.#projectService.findTraceSharingConfig(input.projectId);
  }

  findPersonalWorkspaceOwner(
    input: Readonly<{ organizationId: string; scopeId: string }>,
  ): Promise<{ ownerUserId: string | null } | null> {
    return this.#projectService.findPersonalWorkspaceOwner(input);
  }

  requestTopicClustering(
    input: Readonly<{ projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<TopicClusteringRequest> {
    return this.#operations.requestTopicClustering(input, by);
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.#projectService.touchCodingAgentPullRequestSeen({
      projectId: input.projectId,
      at: input.at,
    });
  }

  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.#projectService.touchCodingAgentSessionSeen({
      projectId: input.projectId,
      at: input.at,
    });
  }

  findInternal(input: InternalProjectQuery): Promise<InternalProject | null> {
    return this.#projectService.findInternal(input);
  }

  ensureInternal(input: InternalProjectQuery): Promise<InternalProject> {
    return this.#projectService.ensureInternal(input);
  }

  findIdentity(id: string): Promise<ProjectIdentity | null> {
    return this.#projectService.findIdentity(id);
  }

  listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes> {
    return this.#projectService.listActiveByScopes(input);
  }

  updateMetadata(input: UpdateProjectMetadataInput): Promise<void> {
    return this.#projectService.updateMetadata(input);
  }

  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution> {
    return this.#projectService.resolveOrgAdmin(projectId);
  }

  resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision> {
    return this.#projectService.resolveTraceDestination(input);
  }

  findTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    return this.#projectService.findTraceDestination(projectId);
  }

  listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    return this.#projectService.listTraceDestinations(projectIds);
  }
}
