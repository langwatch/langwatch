/**
 * What one caller may read of a project through LangWatchQL's catalogue: the tables and columns
 * their grants unlock (AuthZ), and captured content from the SAME resolved data-privacy policy the
 * trace stack redacts by, so a chart never disagrees with the traces.
 */
import type {
  LangWatchQLCatalogueAccess,
  LangWatchQLProtections,
  LangWatchQLRunCaller,
} from "@langwatch/analytics-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AuthzApi, AuthzScopeRef } from "@langwatch/authz-contract";
import {
  isContentVisible,
  isContentVisibleToPublic,
  type ContentCategory,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { NotFoundError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { LWQL_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLCatalogAccessService,
  type LwqlCataloguePrincipal,
} from "./langwatch-ql-catalog-access.service.ts";

type ProjectScope = Extract<AuthzScopeRef, { type: "project" }>;

/** Costs are the catalogue's own `cost:view`, held or not. */
function holdsCostView(catalogue: LangWatchQLCatalogueAccess): boolean {
  return catalogue.permissions.includes("cost:view");
}

const logger: Pick<Logger, "error"> = createLogger("langwatch:analytics:workbench-protections");

export type WorkbenchProtectionsDependencies = Readonly<{
  authz: Pick<
    AuthzApi,
    | "can"
    | "canBatchPermissionsByIds"
    | "getScope"
    | "getAccessBreakdown"
    | "hasPermission"
    | "hasApiKeyPermission"
  >;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projects: Pick<ProjectApi, "findById">;
}>;

/** The protections a member, a credential or the project itself reads LangWatchQL under. */
export class WorkbenchProtectionsService {
  static create(dependencies: WorkbenchProtectionsDependencies): WorkbenchProtectionsService {
    return new WorkbenchProtectionsService(dependencies);
  }

  private readonly access: LangWatchQLCatalogAccessService;

  private constructor(private readonly dependencies: WorkbenchProtectionsDependencies) {
    this.access = LangWatchQLCatalogAccessService.create(dependencies);
  }

  /**
   * Resolves what a signed-in project member may see on the Workbench. Fail-closed: a
   * data-privacy read that throws must hide captured content rather than default it open --
   * a resolver or database failure narrows what a member can see, never widens it.
   */
  async resolveMemberProtections(input: {
    userId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections> {
    const { authz } = this.dependencies;
    const { userId, projectId } = input;
    const permitted = (permission: "traces:view" | "project:update") =>
      authz.hasPermission({ userId, permission, projectId });

    const scope = await this.projectScope(projectId);
    const [catalogue, isMember, isAdmin] = await Promise.all([
      this.catalogueFor({ principal: { type: "user", id: userId }, scope }),
      permitted("traces:view"),
      permitted("project:update"),
    ]);
    const canSeeCosts = holdsCostView(catalogue);

    const policy = await this.policyFor(projectId);
    if (!policy) {
      return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false, catalogue };
    }

    const groupIds = await this.groupIdsFor({ policy, userId, scope });
    const visible = (category: ContentCategory): boolean =>
      isContentVisible(policy.categories[category], {
        isAdmin,
        isMember,
        isMemberRole: isMember,
        isViewer: isMember && !isAdmin,
        // Ownership widens rather than narrows and is not read here, so it stays false.
        isProjectOwner: false,
        groupIds,
      });

    return {
      canSeeCosts,
      canSeeCapturedInput: visible("input"),
      canSeeCapturedOutput: visible("output"),
      catalogue,
    };
  }

  /**
   * The restricted tenant identity a member's own LangWatchQL statement runs as, with their
   * protections. Reads the project through the SAME peer the rollout gate reads -- never a raw
   * Prisma client -- and refuses with `project_not_found` when it no longer exists.
   */
  async resolveRunCaller(input: {
    userId: string;
    projectId: string;
  }): Promise<LangWatchQLRunCaller> {
    const project = await this.dependencies.projects.findById(input.projectId);
    if (!project) {
      throw new NotFoundError("project_not_found", { resource: "Project", id: input.projectId });
    }
    const protections = await this.resolveMemberProtections(input);
    return { project: { id: project.id, lwqlKey: project.lwqlKey }, protections };
  }

  /**
   * What an API KEY may see -- a different question from a person. Content categories resolve as
   * for a no-session caller (a key is not a member); the catalogue is the KEY's own grants, which
   * authz bounds by its owner's. A legacy project key predates RBAC and reads the whole catalogue.
   */
  async resolveApiKeyProtections(input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }): Promise<LangWatchQLProtections> {
    const { credential } = input;
    const catalogue =
      credential.kind === "apiKey" || credential.kind === "cliAccessToken"
        ? await this.catalogueFor({
            principal:
              credential.kind === "apiKey"
                ? { type: "apiKey", id: credential.apiKeyId }
                : { type: "user", id: credential.userId },
            scope: {
              type: "project",
              id: credential.projectId,
              teamId: credential.teamId,
              organizationId: credential.organizationId,
            },
          })
        : await this.catalogueFor({
            principal: { type: "project" },
            scope: await this.projectScope(input.projectId),
          });
    return this.publicProtections({ projectId: input.projectId, catalogue });
  }

  /**
   * What the PROJECT itself may read, with nobody asking: content as a no-session
   * caller sees it, and the whole catalogue, because the job IS the project.
   */
  async resolveProjectProtections(input: { projectId: string }): Promise<LangWatchQLProtections> {
    const catalogue = await this.catalogueFor({
      principal: { type: "project" },
      scope: await this.projectScope(input.projectId),
    });
    return this.publicProtections({ projectId: input.projectId, catalogue });
  }

  /** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
  keyPermitted(input: {
    credential: RestCredentialPrincipal;
    permission: "cost:view" | "analytics:view";
  }): Promise<boolean> {
    const { credential, permission } = input;
    if (credential.kind === "cliAccessToken") {
      return this.dependencies.authz.can({
        principal: { type: "user", id: credential.userId },
        permission,
        scope: {
          type: "project",
          id: credential.projectId,
          teamId: credential.teamId,
          organizationId: credential.organizationId,
        },
      });
    }
    if (credential.kind !== "apiKey") return Promise.resolve(true);

    return this.dependencies.authz.hasApiKeyPermission({
      apiKeyId: credential.apiKeyId,
      userId: credential.userId,
      organizationId: credential.organizationId,
      scope: { type: "project", id: credential.projectId, teamId: credential.teamId },
      permission,
    });
  }

  private async publicProtections({
    projectId,
    catalogue,
  }: {
    projectId: string;
    catalogue: LangWatchQLCatalogueAccess;
  }): Promise<LangWatchQLProtections> {
    const canSeeCosts = holdsCostView(catalogue);
    const policy = await this.policyFor(projectId);
    if (!policy) {
      return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false, catalogue };
    }

    return {
      canSeeCosts,
      canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
      canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
      catalogue,
    };
  }

  /** The whole LangWatchQL catalogue, resolved for this principal at this project. */
  private catalogueFor({
    principal,
    scope,
  }: {
    principal: LwqlCataloguePrincipal;
    scope: ProjectScope;
  }): Promise<LangWatchQLCatalogueAccess> {
    return this.access.resolveAccessibleCatalog({ principal, scope, catalog: LWQL_CATALOG });
  }

  /** The project's place in its organization, as authz knows it; a vanished project refuses. */
  private async projectScope(projectId: string): Promise<ProjectScope> {
    const scope = await this.dependencies.authz.getScope({ projectId });
    if (scope.type !== "project") {
      throw new NotFoundError("project_not_found", { resource: "Project", id: projectId });
    }
    return scope;
  }

  /**
   * The member's groups in the organization, read only when a content audience names a group.
   * Fail-closed: a read that throws answers no groups, which can only narrow what they see.
   */
  private async groupIdsFor({
    policy,
    userId,
    scope,
  }: {
    policy: ResolvedDataPrivacy;
    userId: string;
    scope: ProjectScope;
  }): Promise<string[]> {
    const { input, output } = policy.categories;
    if (input.audience.groupIds.length === 0 && output.audience.groupIds.length === 0) return [];
    try {
      const breakdown = await this.dependencies.authz.getAccessBreakdown({
        organizationId: scope.organizationId,
        userId,
        userName: null,
        userEmail: null,
      });
      return breakdown.groups.map((group) => group.id);
    } catch (error) {
      logger.error(
        { error, projectId: scope.id },
        "group membership read failed; content audiences by group stay closed (fail-closed)",
      );
      return [];
    }
  }

  /** The resolved policy, or none when resolution failed -- which hides captured content. */
  private async policyFor(projectId: string): Promise<ResolvedDataPrivacy | undefined> {
    try {
      return await this.dependencies.dataPrivacy.getResolvedForProject({ projectId });
    } catch (error) {
      logger.error(
        { error, projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return undefined;
    }
  }
}
