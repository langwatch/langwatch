import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { getApp } from "~/server/app-layer/app";
import type { Session } from "~/server/auth";
import {
  describeAudience,
  isContentVisible,
  isContentVisibleToPublic,
  needsAudienceFacts,
  type ViewerFacts,
} from "~/server/data-privacy/contentVisibility";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedAudience,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { createLogger } from "~/utils/logger/server";
import type { Protections } from "../elasticsearch/protections";
import { hasProjectPermission, isDemoProject } from "./rbac";

const logger = createLogger("langwatch:api:protections");

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
      };
    }
  }
  const effInput = policy.categories.input;
  const effOutput = policy.categories.output;
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
    return {
      canSeeCosts,
      canSeeCapturedInput: isContentVisibleToPublic(effInput),
      canSeeCapturedOutput: isContentVisibleToPublic(effOutput),
      hiddenAttributes: restrictedAttributeRules.map((rule) => ({
        pattern: rule.pattern,
        visibleTo: "members of this project",
      })),
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
    }
  }

  // Group membership is only needed when a restrict audience names groups; the
  // role-group and owner audiences decide from facts already in hand, keeping
  // the common read path free of the extra queries.
  let organizationId: string | null = null;
  let groupIds: string[] = [];
  const needsFacts =
    needsAudienceFacts(effInput) ||
    needsAudienceFacts(effOutput) ||
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
    isViewer,
    isProjectOwner,
    groupIds,
  };
  const canSeeCapturedInput = isContentVisible(effInput, viewer);
  const canSeeCapturedOutput = isContentVisible(effOutput, viewer);
  const hiddenAttributeRules = restrictedAttributeRules.filter(
    (rule) =>
      !isContentVisible(
        { disposition: "restrict", audience: rule.audience },
        viewer,
      ),
  );

  // One batched name lookup serves every redaction label this viewer needs.
  const audiencesNeedingLabels: ResolvedAudience[] = [
    ...(!canSeeCapturedInput && effInput.disposition === "restrict"
      ? [effInput.audience]
      : []),
    ...(!canSeeCapturedOutput && effOutput.disposition === "restrict"
      ? [effOutput.audience]
      : []),
    ...hiddenAttributeRules.map((rule) => rule.audience),
  ];
  const names = await resolveAudienceNames(
    ctx.prisma,
    audiencesNeedingLabels,
    organizationId,
  );

  return {
    canSeeCosts,
    canSeeCapturedInput,
    canSeeCapturedOutput,
    capturedInputVisibleTo:
      !canSeeCapturedInput && effInput.disposition === "restrict"
        ? describeAudience(effInput.audience, names)
        : null,
    capturedOutputVisibleTo:
      !canSeeCapturedOutput && effOutput.disposition === "restrict"
        ? describeAudience(effOutput.audience, names)
        : null,
    hiddenAttributes: hiddenAttributeRules.map((rule) => ({
      pattern: rule.pattern,
      visibleTo: describeAudience(rule.audience, names),
    })),
  };
}
