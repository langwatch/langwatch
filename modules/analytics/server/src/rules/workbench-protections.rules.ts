/**
 * What one member may read of a project's content, as LangWatchQL's catalogue
 * asks it. Three booleans, from two independent sources, and they are
 * independent on purpose: costs come from AuthZ, captured content from the
 * SAME resolved data-privacy policy the trace read stack redacts by — taken
 * rather than built, so a chart and the traces behind it never disagree about
 * which fields a project keeps.
 */
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  isContentVisible,
  isContentVisibleToPublic,
  type ContentCategory,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { NotFoundError } from "@langwatch/handled-error";
import type { ProjectApi } from "@langwatch/project-contract";
import type { LangWatchQLProtections, LangWatchQLRunCaller } from "@langwatch/analytics-contract";

const logger: Pick<Logger, "error"> = createLogger("langwatch:analytics:workbench-protections");

/**
 * Resolves what a signed-in project member may see on the Workbench.
 *
 * Fail-closed: a data-privacy read that throws must hide captured content
 * rather than default it open — a resolver or database failure narrows what a
 * member can see, it never widens it.
 */
export async function resolveWorkbenchProtections(input: {
  authz: Pick<AuthzApi, "hasPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  userId: string;
  projectId: string;
}): Promise<LangWatchQLProtections> {
  const { authz, dataPrivacy, userId, projectId } = input;
  const permitted = (permission: "cost:view" | "traces:view" | "project:update") =>
    authz.hasPermission({ userId, permission, projectId });

  const [canSeeCosts, isMember, isAdmin] = await Promise.all([
    permitted("cost:view"),
    permitted("traces:view"),
    permitted("project:update"),
  ]);

  let policy: ResolvedDataPrivacy;
  try {
    policy = await dataPrivacy.getResolvedForProject({ projectId });
  } catch (error) {
    logger.error(
      { error, projectId },
      "data-privacy policy resolution failed; hiding captured content (fail-closed)",
    );
    return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };
  }

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
 * The restricted tenant identity a member's own LangWatchQL statement runs
 * as, together with their protections. Reads the project through the SAME
 * peer the rollout gate reads — never a raw Prisma client here — and refuses
 * with `project_not_found` when it no longer exists.
 */
export async function resolveWorkbenchRunCaller(input: {
  authz: Pick<AuthzApi, "hasPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projects: Pick<ProjectApi, "tryGetById">;
  userId: string;
  projectId: string;
}): Promise<LangWatchQLRunCaller> {
  const { projects, projectId, ...protectionsInput } = input;
  const project = await projects.tryGetById(projectId);
  if (!project) {
    throw new NotFoundError("project_not_found", "Project", projectId);
  }
  const protections = await resolveWorkbenchProtections({ ...protectionsInput, projectId });
  return { project: { id: project.id, lwqlKey: project.lwqlKey }, protections };
}

/**
 * What an API KEY may see, which is a different question from what a person
 * may see.
 *
 * Content categories resolve as they do for a caller with no session,
 * because a key is not a member. Costs are the credential's OWN question: a
 * scoped key holds `cost:view` or it does not, asked here through the same
 * `hasApiKeyPermission` the route chain enforces a declared permission with.
 * A legacy project key predates RBAC and carries full project access by
 * design, so for that credential class alone the answer is yes without a
 * lookup.
 *
 * Fail-closed, the same as {@link resolveWorkbenchProtections}: a
 * data-privacy read that throws hides captured content rather than
 * defaulting it open.
 */
export async function resolveApiKeyProtections(input: {
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projectId: string;
  credential: RestCredentialPrincipal;
}): Promise<LangWatchQLProtections> {
  const { authz, dataPrivacy, projectId, credential } = input;
  const canSeeCosts = await keyPermitted({ authz, credential, permission: "cost:view" });

  let policy: ResolvedDataPrivacy;
  try {
    policy = await dataPrivacy.getResolvedForProject({ projectId });
  } catch (error) {
    logger.error(
      { error, projectId },
      "data-privacy policy resolution failed; hiding captured content (fail-closed)",
    );
    return { canSeeCosts, canSeeCapturedInput: false, canSeeCapturedOutput: false };
  }

  return {
    canSeeCosts,
    canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
    canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
  };
}

/** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
function keyPermitted(input: {
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  credential: RestCredentialPrincipal;
  permission: "cost:view";
}): Promise<boolean> {
  const { authz, credential, permission } = input;
  if (credential.kind !== "apiKey") return Promise.resolve(true);

  return authz.hasApiKeyPermission({
    apiKeyId: credential.apiKeyId,
    userId: credential.userId,
    organizationId: credential.organizationId,
    scope: { type: "project", id: credential.projectId, teamId: credential.teamId },
    permission,
  });
}
