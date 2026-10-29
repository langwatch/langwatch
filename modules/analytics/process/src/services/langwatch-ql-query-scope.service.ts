import {
  LangWatchQLProjectNotFoundError,
  LangWatchQLProjectsRequiredError,
  type LangWatchQLCaller,
  type LangWatchQLKeyReach,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
/**
 * The query door's scope: the projects an API key may read and the protections to redact by.
 * The candidates are enumerated from the key's organization, never taken from the request, and
 * a key that reads nothing is a valid empty scope — the row policy, not the door, is the boundary.
 */
import type { Authorization, RestProjectCredentialPrincipal } from "@langwatch/authorization";
import { PROJECT_KIND, type Project, type ProjectApi } from "@langwatch/project-contract";

import { strictestLangWatchQLProtections } from "../rules/langwatch-ql-query-scope.rules.ts";
import { dedupeInOrder } from "../rules/langwatch-ql-run-params.rules.ts";
import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";
import {
  WorkbenchProtectionsService,
  type WorkbenchProtectionsDependencies,
} from "./workbench-protections.service.ts";

/** The projects one query may read, and the protections its content is redacted by. */
export type LangWatchQLQueryScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  protections: LangWatchQLProtections;
}>;

type ScopeDependencies = WorkbenchProtectionsDependencies &
  Readonly<{ projects: Pick<ProjectApi, "findById" | "listByOrganization"> }>;

type ReadableProject = Readonly<{
  project: Pick<Project, "id" | "lwqlKey" | "teamId">;
  credential: RestProjectCredentialPrincipal;
}>;

export class LangWatchQLQueryScopeService {
  static create(dependencies: ScopeDependencies): LangWatchQLQueryScopeService {
    return new LangWatchQLQueryScopeService(dependencies);
  }

  private readonly protections: WorkbenchProtectionsService;

  private constructor(private readonly dependencies: ScopeDependencies) {
    this.protections = WorkbenchProtectionsService.create(dependencies);
  }

  /**
   * The readable set and the strictest protections across it. Named `projects` narrow the set
   * before any protection is read, and one the key cannot read refuses the whole run. With
   * `requireProjects`, a key for an organization, a team or a person must name them.
   * @throws {LangWatchQLProjectsRequiredError} when required and none are named.
   * @throws {LangWatchQLProjectNotFoundError} for any named project the key cannot read.
   */
  async resolve({
    reach,
    projects,
    requireProjects = false,
  }: {
    reach: LangWatchQLKeyReach;
    projects?: readonly string[];
    requireProjects?: boolean;
  }): Promise<LangWatchQLQueryScope> {
    const named = projects === undefined ? undefined : dedupeInOrder(projects);
    if (requireProjects && named === undefined && reach.kind !== "project") {
      throw new LangWatchQLProjectsRequiredError();
    }
    const readable =
      reach.kind === "project"
        ? [await this.ownProject({ projectId: reach.projectId, requested: named })]
        : await this.readableProjects({ reach, only: named });
    // One project at a time: each answer is several grant reads, and fanning an organization's
    // worth out at once is what exhausts the connection pool.
    const protections: LangWatchQLProtections[] = [];
    for (const { project, credential } of readable) {
      protections.push(
        await this.protections.resolveApiKeyProtections({ projectId: project.id, credential }),
      );
    }

    return {
      projects: readable.map(({ project }) => ({ id: project.id, lwqlKey: project.lwqlKey })),
      protections: strictestLangWatchQLProtections(protections),
    };
  }

  /**
   * The projects a signed-in member's card names and the strictest protections across them.
   * Each must exist and hold `analytics:view` for the member; any that does not refuses the
   * whole run with the one id-free answer, so a card never learns which of them was the cause.
   * @throws {LangWatchQLProjectNotFoundError} for a project missing, foreign or unreadable.
   */
  async resolveMemberProjects({
    userId,
    projectIds,
    authorization,
  }: {
    userId: string;
    projectIds: readonly string[];
    authorization?: Authorization;
  }): Promise<LangWatchQLQueryScope> {
    const projects = await this.readableByMember({ userId, projectIds });
    const protections: LangWatchQLProtections[] = [];
    // One project at a time, for the same reason `resolve` reads protections one at a time.
    for (const { id: projectId } of projects) {
      protections.push(
        await this.protections.resolveMemberProtections({
          userId,
          projectId,
          ...(authorization ? { authorization } : {}),
        }),
      );
    }

    return { projects, protections: strictestLangWatchQLProtections(protections) };
  }

  /**
   * The named projects, each proven to exist and to hold `analytics:view` for the member.
   * @throws {LangWatchQLProjectNotFoundError} for any that does not, with no id in the answer.
   */
  async readableByMember({
    userId,
    projectIds,
  }: {
    userId: string;
    projectIds: readonly string[];
  }): Promise<LangWatchQLCaller[]> {
    const readable: LangWatchQLCaller[] = [];
    for (const projectId of dedupeInOrder(projectIds)) {
      const project = await this.dependencies.projects.findById(projectId);
      const allowed =
        project !== null &&
        project !== undefined &&
        (await this.dependencies.authz.hasPermission({
          userId,
          permission: "analytics:view",
          projectId,
        }));
      if (!project || !allowed) throw new LangWatchQLProjectNotFoundError();
      readable.push({ id: project.id, lwqlKey: project.lwqlKey });
    }

    return readable;
  }

  /**
   * Whether the key clears `analytics:view` at the project it resolved to, as main's reference
   * door asks: a legacy key always does, and a key that resolved no project never does.
   */
  async holdsQueryPermission({ reach }: { reach: LangWatchQLKeyReach }): Promise<boolean> {
    if (reach.kind === "project") return true;
    if (!reach.resolvedProject) return false;

    return this.protections.keyPermitted({
      credential: {
        kind: "apiKey",
        apiKeyId: reach.apiKeyId,
        userId: reach.userId,
        organizationId: reach.organizationId,
        projectId: reach.resolvedProject.id,
        teamId: reach.resolvedProject.teamId,
      },
      permission: "analytics:view",
    });
  }

  /** A legacy project key reaches exactly its own project, with no RBAC fan-out. */
  private async ownProject({
    projectId,
    requested,
  }: {
    projectId: string;
    requested?: readonly string[];
  }): Promise<ReadableProject> {
    if (requested?.some((id) => id !== projectId)) throw new LangWatchQLProjectNotFoundError();
    const project = await this.dependencies.projects.findById(projectId);
    if (!project) throw new LangWatchQLProjectNotFoundError();

    return { project, credential: { kind: "legacyProjectKey" } };
  }

  /**
   * Every live application project in the key's organization it holds `analytics:view` on,
   * decided as `key ∩ owning user` at each project's own scope.
   */
  private async readableProjects({
    reach,
    only,
  }: {
    reach: Extract<LangWatchQLKeyReach, { kind: "apiKey" }>;
    only?: readonly string[];
  }): Promise<ReadableProject[]> {
    const listed = await this.dependencies.projects.listByOrganization({
      organizationId: reach.organizationId,
      page: 1,
      limit: LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
      ...(only === undefined ? {} : { projectIds: [...only] }),
    });
    if (listed.pagination.total > listed.data.length) {
      throw new Error(
        `LangWatchQL key scope spans ${listed.pagination.total} projects, over the ` +
          `${LWQL_TENANT_CAPABILITY_MAX_PROJECTS} cap — narrow the key's project scope`,
      );
    }

    const readable: ReadableProject[] = [];
    for (const project of listed.data) {
      if (project.kind === PROJECT_KIND.INTERNAL_GOVERNANCE) continue;
      const credential: RestProjectCredentialPrincipal = {
        kind: "apiKey",
        apiKeyId: reach.apiKeyId,
        userId: reach.userId,
        organizationId: reach.organizationId,
        projectId: project.id,
        teamId: project.teamId,
      };
      const viewable = await this.protections.keyPermitted({
        credential,
        permission: "analytics:view",
      });
      if (viewable) readable.push({ project, credential });
    }
    if (only === undefined) return readable;
    const byId = new Map(readable.map((entry) => [entry.project.id, entry]));
    const inRequestOrder = only.flatMap((id) => byId.get(id) ?? []);
    if (inRequestOrder.length < only.length) throw new LangWatchQLProjectNotFoundError();

    return inRequestOrder;
  }
}
