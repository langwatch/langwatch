/**
 * The query door's scope: the projects an API key may read and the protections to redact by.
 * The candidates are enumerated from the key's organization, never taken from the request, and
 * a key that reads nothing is a valid empty scope — the row policy, not the door, is the boundary.
 */
import type {
  LangWatchQLCaller,
  LangWatchQLKeyReach,
  LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import type { RestProjectCredentialPrincipal } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { NotFoundError } from "@langwatch/handled-error";
import { PROJECT_KIND, type Project, type ProjectApi } from "@langwatch/project-contract";

import { strictestLangWatchQLProtections } from "../rules/langwatch-ql-query-scope.rules.ts";
import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";
import { WorkbenchProtectionsService } from "./workbench-protections.service.ts";

/** The projects one query may read, and the protections its content is redacted by. */
export type LangWatchQLQueryScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  protections: LangWatchQLProtections;
}>;

type ScopeDependencies = Readonly<{
  authz: Pick<AuthzApi, "hasPermission" | "hasApiKeyPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projects: Pick<ProjectApi, "findById" | "listByOrganization">;
}>;

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

  /** The readable set and the strictest protections across it. */
  async resolve({ reach }: { reach: LangWatchQLKeyReach }): Promise<LangWatchQLQueryScope> {
    const readable =
      reach.kind === "project"
        ? [await this.ownProject(reach.projectId)]
        : await this.readableProjects(reach);
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
  private async ownProject(projectId: string): Promise<ReadableProject> {
    const project = await this.dependencies.projects.findById(projectId);
    if (!project) throw new NotFoundError("project_not_found", "Project", projectId);

    return { project, credential: { kind: "legacyProjectKey" } };
  }

  /**
   * Every live application project in the key's organization it holds `analytics:view` on,
   * decided as `key ∩ owning user` at each project's own scope.
   */
  private async readableProjects(
    reach: Extract<LangWatchQLKeyReach, { kind: "apiKey" }>,
  ): Promise<ReadableProject[]> {
    const listed = await this.dependencies.projects.listByOrganization({
      organizationId: reach.organizationId,
      page: 1,
      limit: LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
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

    return readable;
  }
}
