import { AuditLogApi } from "@langwatch/audit-log-contract";
import { type AuthzPermission } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataPrivacyApi,
  type DataPrivacyPiiRedactionLevel,
} from "@langwatch/data-privacy-contract";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import {
  ProjectApi,
  type ProjectApi as ProjectApiContract,
  type ActiveProjectsByScopes,
  type ActiveProjectsByScopesInput,
  type InternalProject,
  type InternalProjectKind,
  type InternalProjectQuery,
  type OrgAdminResolution,
  type ArchivedProject,
  type Project,
  type ProjectIdentity,
  type ProjectWithTeam,
  type PaginatedProjects,
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
import type { Instant } from "@langwatch/time";

import type { ProjectRepositories } from "../repositories/project.repositories.ts";
import { PersonalProjectService } from "../services/personal-project.service.ts";
import {
  ProjectCreatedNoticeService,
  type ProjectLifecycleSenders,
} from "../services/project-created-notice.service.ts";
import { ProjectCredentialsService } from "../services/project-credentials.service.ts";
import { ProjectOperationsService } from "../services/project-operations.service.ts";
import { ProjectRequestService } from "../services/project-request.service.ts";
import { ProjectService as ProjectApplicationService } from "../services/project.service.ts";
import type { ProjectManagementApi } from "../transport/project.rest.ts";
import type { ProjectBrowserApi, ProjectPermissionScope } from "../transport/project.trpc.ts";

type ProjectDependencies = Readonly<{
  organizations: typeof OrganizationApi;
  /**
   * Asked about a scope the door's declared check did not resolve. Every
   * process that installs this module installs AuthZ, which is what makes it
   * a dependency rather than an answer the door has to carry in.
   */
  authorization: typeof AuthzApi;
  auditLog: typeof AuditLogApi;
  /** Owns the project's PII level, which `/api/projects` reads and writes by name. */
  dataPrivacy: typeof DataPrivacyApi;
}>;
/** The one logger member this module reads; a test hands its own through `create`. */
type ProjectLogger = Readonly<{
  error: (payload: Readonly<Record<string, unknown>>, message: string) => void;
}>;
type ProjectSetup = FeatureSetup<ProjectDependencies, undefined, ProjectRepositories>;

/**
 * The project application: what peer modules, `/api/projects` and the browser
 * door each call, handed through the operations-only proxy — an unserved
 * member throws at first request, which `implements` turns into a build failure.
 */
export class ProjectModule implements ProjectApiContract, ProjectManagementApi, ProjectBrowserApi {
  listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]> {
    return this.#projectService.listPaths(input);
  }

  findProjectsWithDepartments(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; departmentId: string | null }[]> {
    return this.#projectService.findProjectsWithDepartments(input);
  }

  assignProjectDepartment(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.#projectService.assignProjectDepartment(input);
  }

  static readonly contract = ProjectApi;
  static readonly dependencies: ProjectDependencies = {
    organizations: OrganizationApi,
    authorization: AuthzApi,
    auditLog: AuditLogApi,
    dataPrivacy: DataPrivacyApi,
  };

  readonly #projectService: ProjectApplicationService;
  readonly #operations: ProjectOperationsService;
  readonly #lifecycle: ProjectCreatedNoticeService;
  readonly #authorization: AuthzApi;
  readonly #dataPrivacy: DataPrivacyApi;
  readonly #personalProjects: PersonalProjectService;
  readonly #requests = ProjectRequestService.create({
    projects: this,
    probePermission: (input) => this.probePermission(input),
  });
  private constructor({
    projectService,
    operations,
    lifecycle,
    authorization,
    dataPrivacy,
    personalProjects,
  }: {
    projectService: ProjectApplicationService;
    operations: ProjectOperationsService;
    lifecycle: ProjectCreatedNoticeService;
    authorization: AuthzApi;
    dataPrivacy: DataPrivacyApi;
    personalProjects: PersonalProjectService;
  }) {
    this.#projectService = projectService;
    this.#operations = operations;
    this.#lifecycle = lifecycle;
    this.#authorization = authorization;
    this.#dataPrivacy = dataPrivacy;
    this.#personalProjects = personalProjects;
  }

  static create({
    dependencies,
    repositories,
    logger = createLogger("langwatch:project"),
  }: ProjectSetup & { logger?: ProjectLogger }): ProjectModule {
    const lifecycle = ProjectCreatedNoticeService.create({
      logger,
      projects: repositories.projects,
    });
    const projects = ProjectApplicationService.create({
      repository: repositories.projects,
      credentials: ProjectCredentialsService.create(),
      organizations: dependencies.organizations,
      created: lifecycle,
    });
    const operations = ProjectOperationsService.create({
      projects,
      storageSettings: repositories.storageSettings,
      auditLog: dependencies.auditLog,
      lifecycle,
      logger,
    });
    return new ProjectModule({
      projectService: projects,
      operations,
      lifecycle,
      authorization: dependencies.authorization,
      dataPrivacy: dependencies.dataPrivacy,
      personalProjects: PersonalProjectService.create({ projects: repositories.projects }),
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

  /** project_lifecycle's senders, once the pipeline registers in this process. */
  connectLifecycle(senders: ProjectLifecycleSenders): void {
    this.#lifecycle.connect(senders);
  }

  /** Records a project organization created (a personal one, §9); throws so the queue retries. */
  recordProjectCreated(
    input: Readonly<{ projectId: string; organizationId: string }>,
  ): Promise<void> {
    return this.#lifecycle.record(input);
  }

  /** Project's reactions to organization's personal-workspace facts, for the lifecycle pipeline. */
  personalProjects(): PersonalProjectService {
    return this.#personalProjects;
  }

  /** Records one organization's existing projects as created, for the backfill task. */
  recordExistingProjectsCreated(
    input: Readonly<{ organizationId: string; isDryRun?: boolean }>,
  ): Promise<number> {
    return this.#lifecycle.recordExisting(input);
  }

  /** Records one organization's projects' stored departments and teams, for the backfill task. */
  recordExistingDepartmentAssignments(
    input: Readonly<{ organizationId: string }>,
  ): Promise<number> {
    return this.#lifecycle.recordExistingDepartmentAssignments(input);
  }

  /** Records one organization's projects' stored presence settings, for the backfill task. */
  recordExistingPresenceSettings(input: Readonly<{ organizationId: string }>): Promise<number> {
    return this.#lifecycle.recordExistingPresenceSettings(input);
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

  archiveOtherProject(input: {
    projectId: string;
    projectToArchiveId: string;
    by: Readonly<{ id: string }>;
  }): Promise<{ alreadyArchived: boolean }> {
    return this.#requests.archiveOtherProject(input);
  }

  getLegacyKeyStatus(input: { projectId: string }): Promise<{ present: boolean }> {
    return this.#operations.getLegacyKeyStatus(input);
  }

  revokeProjectApiKey(input: { projectId: string; by: Readonly<{ id: string }> }): Promise<void> {
    return this.#operations.revokeLegacyProjectKey({ projectId: input.projectId }, input.by);
  }

  /**
   * The management operations, each scoped to the organization the door's
   * credential resolved — never the project itself — so a token issued for one
   * organization cannot reach another's project.
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
  ): Promise<ArchivedProject> {
    return this.#projectService.archive({
      id: input.projectId,
      organizationId: input.organizationId,
    });
  }

  getPiiRedactionLevel(input: { projectId: string }): Promise<DataPrivacyPiiRedactionLevel> {
    return this.#dataPrivacy.getPiiRedactionLevel(input);
  }

  setPiiRedactionLevel(input: {
    projectId: string;
    level: DataPrivacyPiiRedactionLevel;
  }): Promise<void> {
    return this.#dataPrivacy.setPiiRedactionLevel(input);
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
    includeGovernance?: boolean;
  }): Promise<PaginatedProjects> {
    return this.#projectService.listByOrganization(input);
  }

  listByTeam(input: {
    organizationId: string;
    teamId: string;
    includeGovernance?: boolean;
  }): Promise<Project[]> {
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

  countWithTraces(input: { organizationId: string }): Promise<number> {
    return this.#projectService.countWithTraces(input);
  }

  listAllIds(
    input?: projectContractModule.ProjectIdPageInput,
  ): Promise<projectContractModule.ProjectIdPage> {
    return this.#projectService.listAllIds(input);
  }

  findSharedProjectSlugs(input: {
    organizationId: string;
    memberUserId?: string;
    limit: number;
  }): Promise<string[]> {
    return this.#projectService.findSharedProjectSlugs(input);
  }

  listIdsByOrganization(
    input: projectContractModule.ProjectIdsByOrganizationInput,
  ): Promise<string[]> {
    return this.#projectService.listIdsByOrganization(input);
  }

  findLiveNonGovernanceIdsByOrganization(
    input: projectContractModule.LiveProjectIdsByOrganizationInput,
  ): Promise<string[]> {
    return this.#projectService.findLiveNonGovernanceIdsByOrganization(input);
  }

  findLiveBySlug(
    input: Readonly<{ slug: string; organizationId: string }>,
  ): Promise<projectContractModule.Project[]> {
    return this.#projectService.findLiveBySlug(input);
  }

  findLiveByRef(
    input: Readonly<{ projectRef: string; organizationId: string }>,
  ): Promise<projectContractModule.Project[]> {
    return this.#projectService.findLiveByRef(input);
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

  updateSettings(
    input: Readonly<UpdateProjectInput & { projectId: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<Project> {
    return this.#operations.updateSettings(input, by);
  }

  archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }> {
    return this.#operations.archive(input);
  }

  findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null> {
    return this.#projectService.findIdByLegacyApiKey(input);
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

  findInternalIds(input: { kind: InternalProjectKind }): Promise<string[]> {
    return this.#projectService.findInternalIds(input);
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
