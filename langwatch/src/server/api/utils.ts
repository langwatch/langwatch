import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { getApp } from "~/server/app-layer/app";
import { VisibilityWindowService } from "~/server/app-layer/traces/visibility-window.service";
import type { Session } from "~/server/auth";
import {
  describeAudience,
  isContentVisible,
  isContentVisibleToPublic,
  needsAudienceFacts,
  type ViewerFacts,
} from "~/server/data-privacy/contentVisibility";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedAudience,
  type ResolvedCategory,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import { FREE_VISIBILITY_DAYS } from "../../../ee/licensing/constants";
import type {
  CategoryVisibility,
  Protections,
} from "../elasticsearch/protections";
import { hasProjectPermission, isDemoProject } from "./rbac";

const logger = createLogger("langwatch:api:protections");

/**
 * Cache: projectId -> visibilityDays sentinel ("none" = no window). Plan
 * resolution is an uncached Prisma read; a short TTL keeps the per-request
 * cost near zero while plan changes still apply within a minute. The CUTOFF
 * itself is computed fresh per call (it moves with `now`), only the plan
 * lookup is cached.
 */
const visibilityDaysCache = new TtlCache<number | "none">(
  60 * 1000,
  "ttlcache:visibility-days:",
);

const visibilityLogger = createLogger("langwatch:visibility-window");

/**
 * Resolves the plan-based visibility cutoff for a project's organization.
 * Fails CLOSED: unresolvable org or plan errors apply the free-tier window
 * (a leak is irreversible; over-blur is a refresh away).
 */
export async function getVisibilityCutoffMsForProject(
  projectId: string,
): Promise<number | null> {
  const dayMs = 24 * 60 * 60 * 1000;
  const failClosedCutoff = () => Date.now() - FREE_VISIBILITY_DAYS * dayMs;

  const cached = await visibilityDaysCache.get(projectId);
  if (cached !== undefined) {
    return cached === "none" ? null : Date.now() - cached * dayMs;
  }

  try {
    const organizationId = await resolveOrganizationId(projectId);
    if (!organizationId) {
      visibilityLogger.error(
        { projectId },
        "visibility window failing closed: project resolves to no organization",
      );
      return failClosedCutoff();
    }
    // Throws on plan-resolution failure — only real plan answers reach the
    // cache below.
    const cutoffMs = await new VisibilityWindowService(
      getApp().planProvider,
    ).getVisibilityCutoffMs({ organizationId });
    const visibilityDays =
      cutoffMs === null
        ? ("none" as const)
        : Math.round((Date.now() - cutoffMs) / dayMs);
    await visibilityDaysCache.set(projectId, visibilityDays);
    return cutoffMs;
  } catch (error) {
    // Fail-closed results are NOT cached — a transient plan-store error
    // should not pin paying customers to the free window for the TTL.
    visibilityLogger.error(
      { projectId, error },
      "visibility window failing closed: plan resolution failed",
    );
    return failClosedCutoff();
  }
}

export const extractCheckKeys = (
  inputObject: Record<string, any>,
): string[] => {
  const keys: string[] = [];

  const recurse = (obj: Record<string, any>) => {
    for (const key of Object.keys(obj)) {
      if (
        key.startsWith("check_") ||
        key.startsWith("eval_") ||
        key.startsWith("evaluation_")
      ) {
        keys.push(key);
      }
      if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
        recurse(obj[key]);
      }
    }
  };

  recurse(inputObject);
  return keys;
};

export const flattenObjectKeys = (
  obj: Record<string, any>,
  prefix = "",
): string[] => {
  return Object.entries(obj).reduce((acc: string[], [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      // If it's an object (but not null or an array), recurse
      return [...acc, ...flattenObjectKeys(value, newKey)];
    } else {
      // For non-object values (including arrays), add the key
      return [...acc, newKey];
    }
  }, []);
};

export async function getProtectionsForProject(
  prisma: PrismaClient,
  { projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  const protections = await getUserProtectionsForProject(
    { prisma, session: null, publiclyShared: false },
    { projectId },
  );

  // API key holders have full project access — all roles grant cost:view
  return { ...protections, canSeeCosts: true };
}

// New function for internal operations that need full access
export async function getInternalProtectionsForProject(
  _prisma: PrismaClient,
  { projectId: _projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  return {
    canSeeCosts: true,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
  };
}

/**
 * Resolve the group display names referenced by a set of audiences in one
 * batched lookup (the organization scopes it), so several redaction labels can
 * be built without one query per audience.
 */
async function resolveAudienceNames(
  prisma: PrismaClient,
  audiences: ResolvedAudience[],
  organizationId: string | null,
): Promise<{
  groups: Record<string, string>;
}> {
  const groupIds = [...new Set(audiences.flatMap((a) => a.groupIds))];
  if (!organizationId || groupIds.length === 0) {
    return { groups: {} };
  }
  const groupRows = await prisma.group.findMany({
    where: { id: { in: groupIds }, organizationId },
    select: { id: true, name: true },
  });
  return {
    groups: Object.fromEntries(groupRows.map((g) => [g.id, g.name])),
  };
}

/** A per-category visibility map where every category shares one decision. */
function uniformContentCategories(
  canSee: boolean,
): Record<ContentCategory, CategoryVisibility> {
  return Object.fromEntries(
    CONTENT_CATEGORIES.map((category) => [
      category,
      { canSee, restrictVisibleTo: null },
    ]),
  ) as Record<ContentCategory, CategoryVisibility>;
}

/**
 * The audience label for a `restrict` category (whether or not the viewer can
 * see it), so the trace view can name the audience on a hidden placeholder and
 * mark restricted-but-visible content for an in-audience viewer. Null for a
 * non-restrict disposition.
 */
function restrictLabelFor(
  category: ResolvedCategory,
  names: { groups: Record<string, string> },
): string | null {
  return category.disposition === "restrict"
    ? describeAudience(category.audience, names)
    : null;
}

export async function getUserProtectionsForProject(
  ctx: {
    prisma: PrismaClient;
    session: Session | null;
    publiclyShared?: boolean;
  },
  { projectId }: { projectId: string } & Record<string, unknown>,
): Promise<Protections> {
  // TODO(afr): Should we show cost if public? I would assume the opposite.
  const canSeeCosts =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    ctx.publiclyShared ||
    (await hasProjectPermission(ctx, projectId, "cost:view"));

  // The plan-based visibility window applies to every user-facing read,
  // including public shares — sharing must not be the bypass.
  const visibilityCutoffMs = await getVisibilityCutoffMsForProject(projectId);

  const project = await ctx.prisma.project.findUniqueOrThrow({
    where: { id: projectId, archivedAt: null },
    select: {
      teamId: true,
      ownerUserId: true,
    },
  });

  // The scoped data-privacy policy is the single source of truth for content
  // visibility. The kill switch falls back to the platform default (every
  // category captured and visible to the team).
  let policy: ResolvedDataPrivacy = PLATFORM_DEFAULT_DATA_PRIVACY;
  if (process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT !== "off") {
    try {
      policy = await getDataPrivacyPolicyService().getResolvedForProject({
        projectId,
      });
    } catch (error) {
      // Fail closed: a resolver/cache/db failure must not expose content that a
      // restrict rule would otherwise hide. Deny captured input/output (the
      // viewer sees the redacted placeholder) until resolution recovers; cost
      // visibility keeps its own permission check. The kill switch path above
      // skips this and keeps the legacy-enum behavior.
      logger.error(
        { error, projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return {
        canSeeCosts,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: null,
        capturedOutputVisibleTo: null,
        contentCategories: uniformContentCategories(false),
        visibilityCutoffMs,
      };
    }
  }
  const restrictedAttributeRules = policy.customAttributes.filter(
    (rule) => rule.disposition === "restrict",
  );

  // For public shares or non-signed in users, only captured content is visible,
  // and every restricted custom attribute is hidden.
  if (
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    ctx.publiclyShared ||
    !ctx.session?.user?.id ||
    isDemoProject(projectId, "traces:view")
  ) {
    // A public viewer has no group facts, so restrict labels resolve any group
    // ids to a generic word; that only affects the placeholder copy, not the
    // visibility decision (public sees captured content only).
    const publicContentCategories = Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => [
        category,
        {
          canSee: isContentVisibleToPublic(policy.categories[category]),
          restrictVisibleTo: restrictLabelFor(policy.categories[category], {
            groups: {},
          }),
        } satisfies CategoryVisibility,
      ]),
    ) as Record<ContentCategory, CategoryVisibility>;
    return {
      canSeeCosts,
      canSeeCapturedInput: publicContentCategories.input.canSee,
      canSeeCapturedOutput: publicContentCategories.output.canSee,
      contentCategories: publicContentCategories,
      hiddenAttributes: restrictedAttributeRules.map((rule) => ({
        pattern: rule.pattern,
        visibleTo: "members of this project",
      })),
      visibilityCutoffMs,
    };
  }

  const userId = ctx.session.user.id;
  const teamBindings = await ctx.prisma.roleBinding.findMany({
    where: {
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: project.teamId,
    },
    select: { role: true },
  });

  let isAdmin = teamBindings.some((b) => b.role === TeamUserRole.ADMIN);
  let isMember = teamBindings.length > 0;
  let isMemberRole = teamBindings.some((b) => b.role === TeamUserRole.MEMBER);
  const isViewer = teamBindings.some((b) => b.role === TeamUserRole.VIEWER);
  const isProjectOwner =
    project.ownerUserId != null && project.ownerUserId === userId;
  if (!isMember) {
    const orgRole = await getApp().organizations.getUserOrgRoleByTeamId({
      userId,
      teamId: project.teamId,
    });
    if (orgRole === OrganizationUserRole.ADMIN) {
      isMember = true;
      isAdmin = true;
    } else if (orgRole === OrganizationUserRole.MEMBER) {
      isMember = true;
      isMemberRole = true;
    }
  }

  // Group membership is only needed when a restrict audience names groups; the
  // role-group and owner audiences decide from facts already in hand, keeping
  // the common read path free of the extra queries.
  let organizationId: string | null = null;
  let groupIds: string[] = [];
  const needsFacts =
    CONTENT_CATEGORIES.some((category) =>
      needsAudienceFacts(policy.categories[category]),
    ) ||
    restrictedAttributeRules.some((rule) =>
      needsAudienceFacts({ disposition: "restrict", audience: rule.audience }),
    );
  if (isMember && needsFacts) {
    const team = await ctx.prisma.team.findUnique({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    organizationId = team?.organizationId ?? null;
    if (organizationId) {
      const memberships = await ctx.prisma.groupMembership.findMany({
        where: { userId, group: { organizationId } },
        select: { groupId: true },
      });
      groupIds = memberships.map((m) => m.groupId);
    }
  }

  const viewer: ViewerFacts = {
    isAdmin,
    isMember,
    isMemberRole,
    isViewer,
    isProjectOwner,
    groupIds,
  };
  const hiddenAttributeRules = restrictedAttributeRules.filter(
    (rule) =>
      !isContentVisible(
        { disposition: "restrict", audience: rule.audience },
        viewer,
      ),
  );

  // One batched name lookup serves every label this viewer needs: every
  // restrict category (whether or not it is visible to them, since an
  // in-audience viewer is also told which audience the content is limited to)
  // plus the custom attribute rules hidden from them.
  const audiencesNeedingLabels: ResolvedAudience[] = [
    ...CONTENT_CATEGORIES.filter(
      (category) => policy.categories[category].disposition === "restrict",
    ).map((category) => policy.categories[category].audience),
    ...hiddenAttributeRules.map((rule) => rule.audience),
  ];
  const names = await resolveAudienceNames(
    ctx.prisma,
    audiencesNeedingLabels,
    organizationId,
  );

  const contentCategories = Object.fromEntries(
    CONTENT_CATEGORIES.map((category) => [
      category,
      {
        canSee: isContentVisible(policy.categories[category], viewer),
        restrictVisibleTo: restrictLabelFor(policy.categories[category], names),
      } satisfies CategoryVisibility,
    ]),
  ) as Record<ContentCategory, CategoryVisibility>;

  return {
    canSeeCosts,
    canSeeCapturedInput: contentCategories.input.canSee,
    canSeeCapturedOutput: contentCategories.output.canSee,
    capturedInputVisibleTo: contentCategories.input.canSee
      ? null
      : contentCategories.input.restrictVisibleTo,
    capturedOutputVisibleTo: contentCategories.output.canSee
      ? null
      : contentCategories.output.restrictVisibleTo,
    contentCategories,
    hiddenAttributes: hiddenAttributeRules.map((rule) => ({
      pattern: rule.pattern,
      visibleTo: describeAudience(rule.audience, names),
    })),
    visibilityCutoffMs,
  };
}
