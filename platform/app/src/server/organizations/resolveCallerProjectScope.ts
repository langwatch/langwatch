import type { PrismaClient } from "~/generated/prisma/client";
import { batchScopePermissions } from "~/server/api/rbac";
import type { Session } from "~/server/auth";
import { prisma as defaultPrisma } from "~/server/db";

/**
 * The organization's projects split by what one caller may do with each: read
 * traces, and price them, plus how each one is named to a reader.
 *
 * Two separate cuts on purpose. `traces:view` decides whether a project's work
 * appears at all; `cost:view` decides whether that work carries money. A
 * project the caller may read but not price still contributes its tokens with
 * a null cost, because the work happened and hiding it would understate the
 * answer.
 *
 * The project list is enumerated HERE, from the organization, and never taken
 * from the request: a caller that could name the projects to count could count
 * one it may not read. Resolved through the same `batchScopePermissions` the
 * in-app surfaces use, in a fixed number of queries rather than one per
 * project, so the REST answer and the page's answer cannot drift.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
export interface CallerProjectDisplay {
  /** The project's own name. */
  name: string;
  /** The project's slug, which addresses its pages. */
  slug: string;
  /** Whether the project is one person's workspace rather than a shared one. */
  isPersonal: boolean;
  /**
   * Who work in this project is attributed to. A personal workspace is one
   * person, so it is named by that person; a shared project is named by
   * itself, because the work inside it belongs to the project rather than to
   * anyone the platform can identify.
   */
  contributorLabel: string;
  /**
   * Whether `contributorLabel` names a project a reader can open, rather than
   * a person. Personal workspaces never link: the label is somebody's name,
   * and the workspace behind it is theirs alone.
   */
  isLinkable: boolean;
}

export interface CallerProjectScope {
  /** Projects the caller may read. Work outside it never appears. */
  permittedProjectIds: string[];
  /** The subset of those the caller may also price. */
  costProjectIds: string[];
  /** How each permitted project is named to a reader, keyed by project id. */
  projects: Record<string, CallerProjectDisplay>;
}

/**
 * The API-key half of a credential-authenticated caller, when the caller is a
 * key rather than a signed-in session.
 *
 * A key can carry bindings NARROWER than its holder's own — that ceiling is
 * the whole point of a restricted key — so a scope resolved from the holder
 * alone would let a deliberately narrowed key read with the holder's full
 * reach. `check` is `PermissionsService.hasApiKeyPermission`
 * (`effective = key bindings ∩ owning user's bindings`), injected as a
 * function so this module does not depend on the app layer.
 */
export interface CallerApiKeyCeiling {
  apiKeyId: string;
  check: (check: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    scope: { type: "project"; id: string; teamId: string };
    permission: "traces:view" | "cost:view";
  }) => Promise<boolean>;
}

export async function resolveCallerProjectScope({
  userId,
  organizationId,
  prisma = defaultPrisma,
  apiKeyCeiling,
}: {
  userId: string;
  organizationId: string;
  prisma?: PrismaClient;
  /** Present when the caller is an API-key credential. @see CallerApiKeyCeiling */
  apiKeyCeiling?: CallerApiKeyCeiling;
}): Promise<CallerProjectScope> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId }, archivedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      teamId: true,
      isPersonal: true,
    },
  });
  if (projects.length === 0) {
    return { permittedProjectIds: [], costProjectIds: [], projects: {} };
  }

  const projectTeamId = Object.fromEntries(
    projects.map((project) => [project.id, project.teamId]),
  );
  const ctx = {
    prisma,
    // Minimal session shape: the resolver only reads user.id.
    session: { user: { id: userId }, expires: "" } satisfies Session,
  };
  const args = {
    organizationId,
    teamIds: [],
    projectIds: projects.map((project) => project.id),
    projectTeamId,
  };
  const [viewable, priceable] = await Promise.all([
    batchScopePermissions(ctx, { ...args, permission: "traces:view" }),
    batchScopePermissions(ctx, { ...args, permission: "cost:view" }),
  ]);

  const userPermitted = projects.filter(
    (project) => viewable.projects.get(project.id) === true,
  );
  // The credential's own ceiling, applied after the holder's cut: both halves
  // must allow a project before it appears, and both before it is priced.
  const permitted = await withinApiKeyCeiling({
    apiKeyCeiling,
    userId,
    organizationId,
    projects: userPermitted,
    permission: "traces:view",
  });
  const userPriceable = permitted.filter(
    (project) => priceable.projects.get(project.id) === true,
  );
  const priceableWithinCeiling = await withinApiKeyCeiling({
    apiKeyCeiling,
    userId,
    organizationId,
    projects: userPriceable,
    permission: "cost:view",
  });

  const ownerNames = await personalTeamOwnerNames({
    prisma,
    teamIds: permitted
      .filter((project) => project.isPersonal)
      .map((project) => project.teamId),
  });

  return {
    permittedProjectIds: permitted.map((project) => project.id),
    costProjectIds: priceableWithinCeiling.map((project) => project.id),
    projects: projectDisplayRecord({ permitted, ownerNames }),
  };
}

/** How each permitted project is named to a reader, keyed by project id. */
function projectDisplayRecord({
  permitted,
  ownerNames,
}: {
  permitted: Array<{
    id: string;
    name: string;
    slug: string;
    teamId: string;
    isPersonal: boolean;
  }>;
  ownerNames: Map<string, string>;
}): Record<string, CallerProjectDisplay> {
  return Object.fromEntries(
    permitted.map((project) => [
      project.id,
      {
        name: project.name,
        slug: project.slug,
        isPersonal: project.isPersonal,
        contributorLabel: project.isPersonal
          ? (ownerNames.get(project.teamId) ?? project.name)
          : project.name,
        isLinkable: !project.isPersonal,
      } satisfies CallerProjectDisplay,
    ]),
  );
}

/**
 * The projects a credential's own bindings reach, out of an already
 * user-permitted list.
 *
 * One decision per project through the injected `check`, in parallel: the
 * decision is `key ∩ user` at the project's scope, exactly what every other
 * REST door asks (`enforceApiKeyCeiling`, `requireProjectPermission`), so a
 * key narrowed to one project answers here the way it answers everywhere
 * else. No ceiling means a session-authenticated caller, and the list passes
 * through untouched.
 */
async function withinApiKeyCeiling<P extends { id: string; teamId: string }>({
  apiKeyCeiling,
  userId,
  organizationId,
  projects,
  permission,
}: {
  apiKeyCeiling: CallerApiKeyCeiling | undefined;
  userId: string;
  organizationId: string;
  projects: P[];
  permission: "traces:view" | "cost:view";
}): Promise<P[]> {
  if (!apiKeyCeiling || projects.length === 0) return projects;
  const allowed = await Promise.all(
    projects.map((project) =>
      apiKeyCeiling.check({
        apiKeyId: apiKeyCeiling.apiKeyId,
        userId,
        organizationId,
        scope: { type: "project", id: project.id, teamId: project.teamId },
        permission,
      }),
    ),
  );
  return projects.filter((_, index) => allowed[index] === true);
}

/**
 * The person behind each personal workspace, keyed by team id.
 *
 * One query for every personal team at once, and never for a shared one: a
 * shared team's members are not an answer to "who worked here", so fetching
 * them would cost a read that nothing displays. A personal team holds exactly
 * one member, and the earliest one wins if a team ever holds more.
 */
async function personalTeamOwnerNames({
  prisma,
  teamIds,
}: {
  prisma: PrismaClient;
  teamIds: string[];
}): Promise<Map<string, string>> {
  if (teamIds.length === 0) return new Map();
  const members = await prisma.teamUser.findMany({
    where: { teamId: { in: teamIds } },
    select: { teamId: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const names = new Map<string, string>();
  for (const member of members) {
    if (names.has(member.teamId)) continue;
    // The schema has no foreign keys, so a membership row can outlive its
    // user; a missing user names nothing rather than failing the read.
    const label = member.user?.name?.trim() || member.user?.email?.trim();
    if (label) names.set(member.teamId, label);
  }
  return names;
}
