import type { LangWatchQLProtections, LangWatchQLRunCaller } from "@langwatch/analytics-contract";
/**
 * What one member may read of a project's content, per LangWatchQL's catalogue: three booleans
 * from two independent sources -- costs from AuthZ, captured content from the SAME resolved
 * data-privacy policy the trace stack redacts by, so a chart never disagrees with the traces.
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
import { NotFoundError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

const logger: Pick<Logger, "error"> = createLogger("langwatch:analytics:workbench-protections");

/**
 * Resolves what a signed-in project member may see on the Workbench. Fail-closed: a
 * data-privacy read that throws must hide captured content rather than default it open --
 * a resolver or database failure narrows what a member can see, never widens it.
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
 * The restricted tenant identity a member's own LangWatchQL statement runs as, with their
 * protections. Reads the project through the SAME peer the rollout gate reads -- never a raw
 * Prisma client -- and refuses with `project_not_found` when it no longer exists.
 */
export async function resolveWorkbenchRunCaller(input: {
  authz: Pick<AuthzApi, "hasPermission">;
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projects: Pick<ProjectApi, "findById">;
  userId: string;
  projectId: string;
}): Promise<LangWatchQLRunCaller> {
  const { projects, projectId, ...protectionsInput } = input;
  const project = await projects.findById(projectId);
  if (!project) {
    throw new NotFoundError("project_not_found", "Project", projectId);
  }
  const protections = await resolveWorkbenchProtections({ ...protectionsInput, projectId });
  return { project: { id: project.id, lwqlKey: project.lwqlKey }, protections };
}

/**
 * What an API KEY may see -- a different question from a person. Content categories resolve as
 * for a no-session caller (a key is not a member); costs are the credential's OWN `cost:view` via
 * `hasApiKeyPermission`, except a legacy project key, which predates RBAC and always answers yes.
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

/**
 * What the PROJECT itself may read, with nobody asking: content as a no-session
 * caller sees it, and the project's own costs, because the job IS the project.
 */
export async function resolveProjectProtections(input: {
  dataPrivacy: Pick<DataPrivacyApi, "getResolvedForProject">;
  projectId: string;
}): Promise<LangWatchQLProtections> {
  const { dataPrivacy, projectId } = input;

  let policy: ResolvedDataPrivacy;
  try {
    policy = await dataPrivacy.getResolvedForProject({ projectId });
  } catch (error) {
    logger.error(
      { error, projectId },
      "data-privacy policy resolution failed; hiding captured content (fail-closed)",
    );

    return { canSeeCosts: true, canSeeCapturedInput: false, canSeeCapturedOutput: false };
  }

  return {
    canSeeCosts: true,
    canSeeCapturedInput: isContentVisibleToPublic(policy.categories.input),
    canSeeCapturedOutput: isContentVisibleToPublic(policy.categories.output),
  };
}

/** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
export function keyPermitted(input: {
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  credential: RestCredentialPrincipal;
  permission: "cost:view" | "analytics:view";
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
