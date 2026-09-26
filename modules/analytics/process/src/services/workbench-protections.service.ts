/**
 * What one member may read of a project's content, per LangWatchQL's catalogue: three booleans
 * from two independent sources -- costs from AuthZ, captured content from the SAME resolved
 * data-privacy policy the trace stack redacts by, so a chart never disagrees with the traces.
 */
import type { LangWatchQLProtections, LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
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

const logger: Pick<Logger, "error"> = createLogger("langwatch:analytics:workbench-protections");

export type WorkbenchProtectionsDependencies = Readonly<{
  authz: Pick<AuthzApi, "hasPermission" | "hasApiKeyPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projects: Pick<ProjectApi, "findById">;
}>;

/** The protections a member, a credential or the project itself reads LangWatchQL under. */
export class WorkbenchProtectionsService {
  static create(dependencies: WorkbenchProtectionsDependencies): WorkbenchProtectionsService {
    return new WorkbenchProtectionsService(dependencies);
  }

  private constructor(private readonly dependencies: WorkbenchProtectionsDependencies) {}

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
    const permitted = (permission: "cost:view" | "traces:view" | "project:update") =>
      authz.hasPermission({ userId, permission, projectId });

    const [canSeeCosts, isMember, isAdmin] = await Promise.all([
      permitted("cost:view"),
      permitted("traces:view"),
      permitted("project:update"),
    ]);

    const policy = await this.policyFor(projectId);
    if (!policy) return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };

    const visible = (category: ContentCategory): boolean =>
      isContentVisible(policy.categories[category], {
        isAdmin,
        isMember,
        isMemberRole: isMember,
        isViewer: isMember && !isAdmin,
        // Neither is resolvable from this module's dependencies, and both widen
        // rather than narrow, so both stay false.
        isProjectOwner: false,
        groupIds: [],
      });

    return {
      canSeeCosts,
      canSeeCapturedInput: visible("input"),
      canSeeCapturedOutput: visible("output"),
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
      throw new NotFoundError("project_not_found", "Project", input.projectId);
    }
    const protections = await this.resolveMemberProtections(input);
    return { project: { id: project.id, lwqlKey: project.lwqlKey }, protections };
  }

  /**
   * What an API KEY may see -- a different question from a person. Content categories resolve as
   * for a no-session caller (a key is not a member); costs are the credential's OWN `cost:view` via
   * `hasApiKeyPermission`, except a legacy project key, which predates RBAC and always answers yes.
   */
  async resolveApiKeyProtections(input: {
    projectId: string;
    credential: RestCredentialPrincipal;
  }): Promise<LangWatchQLProtections> {
    const canSeeCosts = await this.keyPermitted({
      credential: input.credential,
      permission: "cost:view",
    });
    return this.publicProtections({ projectId: input.projectId, canSeeCosts });
  }

  /**
   * What the PROJECT itself may read, with nobody asking: content as a no-session
   * caller sees it, and the project's own costs, because the job IS the project.
   */
  resolveProjectProtections(input: { projectId: string }): Promise<LangWatchQLProtections> {
    return this.publicProtections({ projectId: input.projectId, canSeeCosts: true });
  }

  /** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
  keyPermitted(input: {
    credential: RestCredentialPrincipal;
    permission: "cost:view" | "analytics:view";
  }): Promise<boolean> {
    const { credential, permission } = input;
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
    canSeeCosts,
  }: {
    projectId: string;
    canSeeCosts: boolean;
  }): Promise<LangWatchQLProtections> {
    const policy = await this.policyFor(projectId);
    if (!policy) return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };

    return {
      canSeeCosts,
      canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
      canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
    };
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
