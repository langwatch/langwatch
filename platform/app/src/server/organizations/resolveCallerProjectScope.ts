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
 * reach. `cuts` is `PermissionsService.apiKeyProjectCuts`
 * (`effective = key bindings ∩ owning user's bindings` per project; for a
 * service key, which owns no user, the key's bindings alone), injected as a
 * function so this module does not depend on the app layer.
 *
 * A BATCH by contract: it is called once with every project and both
 * permissions, and the implementation collects the key's grant snapshot once
 * and decides in memory. Deciding per project opened a database pass per
 * project per permission, and a large organization's fan-out exhausted the
 * connection pool (P2024) and turned the rollup into a 500.
 */
export interface CallerApiKeyCeiling {
  apiKeyId: string;
  cuts: (query: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    projects: ReadonlyArray<{ projectId: string; teamId: string }>;
    permissions: readonly ("traces:view" | "cost:view")[];
  }) => Promise<ReadonlyMap<string, ReadonlyMap<string, boolean>>>;
}

export async function resolveCallerProjectScope({
  userId,
  organizationId,
  prisma = defaultPrisma,
  apiKeyCeiling,
}: {
  /**
   * The person the caller acts as, or null for an organization service key,
   * which acts as nobody: its scope is then its bindings alone, so
   * `apiKeyCeiling` is required with it.
   */
  userId: string | null;
  organizationId: string;
  prisma?: PrismaClient;
  /** Present when the caller is an API-key credential. @see CallerApiKeyCeiling */
  apiKeyCeiling?: CallerApiKeyCeiling;
}): Promise<CallerProjectScope> {
  if (userId === null && !apiKeyCeiling) {
    // A mis-wired route, not a caller mistake: with neither a person nor a
    // key there is nobody to scope the answer by. Fails plain (ADR-045).
    throw new Error(
      "resolveCallerProjectScope needs an apiKeyCeiling when no user is given — a service key's scope is its bindings",
    );
  }
  const projects = await prisma.project.findMany({
    where: {
      team: { organizationId },
      archivedAt: null,
      kind: { not: "internal_governance" },
    },
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

  const { viewable, priceable } = await userPermissionCuts({
    prisma,
    userId,
    organizationId,
    projects,
  });

  const userPermitted = projects.filter((project) => viewable(project.id));
  // The credential's own ceiling, applied after the holder's cut: both halves
  // must allow a project before it appears, and both before it is priced. For
  // a service key the holder's cut passes everything through, so the ceiling
  // — the key's own bindings — is the whole of the answer. ONE batched ask
  // for every project and both permissions: the ceiling collects the key's
  // grant snapshot once and decides in memory, never a pass per project.
  const ceiling = await apiKeyCeilingCuts({
    apiKeyCeiling,
    userId,
    organizationId,
    projects: userPermitted,
  });
  const permitted = userPermitted.filter((project) =>
    ceiling.viewable(project.id),
  );
  const priceableWithinCeiling = permitted.filter(
    (project) => priceable(project.id) && ceiling.priceable(project.id),
  );

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

/**
 * The holder's own per-project permissions, as predicates by project id —
 * or an everything-passes cut when the credential acts as nobody.
 *
 * A service key has no user half to intersect: its bindings, checked by the
 * ceiling, are the whole of what it may read, so the user cut must not
 * subtract anything. A person's cut resolves through the same
 * `batchScopePermissions` the in-app surfaces use, in a fixed number of
 * queries, so the REST answer and the page's answer cannot drift.
 */
async function userPermissionCuts({
  prisma,
  userId,
  organizationId,
  projects,
}: {
  prisma: PrismaClient;
  userId: string | null;
  organizationId: string;
  projects: Array<{ id: string; teamId: string }>;
}): Promise<{
  viewable: (projectId: string) => boolean;
  priceable: (projectId: string) => boolean;
}> {
  if (userId === null) {
    const everything = () => true;
    return { viewable: everything, priceable: everything };
  }

  const ctx = {
    prisma,
    // Minimal session shape: the resolver only reads user.id.
    session: { user: { id: userId }, expires: "" } satisfies Session,
  };
  const args = {
    organizationId,
    teamIds: [],
    projectIds: projects.map((project) => project.id),
    projectTeamId: Object.fromEntries(
      projects.map((project) => [project.id, project.teamId]),
    ),
  };
  const [viewable, priceable] = await Promise.all([
    batchScopePermissions(ctx, { ...args, permission: "traces:view" }),
    batchScopePermissions(ctx, { ...args, permission: "cost:view" }),
  ]);
  return {
    viewable: (projectId) => viewable.projects.get(projectId) === true,
    priceable: (projectId) => priceable.projects.get(projectId) === true,
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
 * The credential's own per-project cut, as predicates by project id.
 *
 * One batched decision for every project and both permissions through the
 * injected `cuts`: the decision per (project, permission) is `key ∩ user` at
 * the project's scope, exactly what every other REST door asks
 * (`enforceApiKeyCeiling`, `requireProjectPermission`), so a key narrowed to
 * one project answers here the way it answers everywhere else — but the
 * grant snapshots behind those decisions are collected once, not once per
 * project. No ceiling means a session-authenticated caller, and everything
 * passes through.
 *
 * Absent answers deny: a project the batch did not answer for is refused
 * rather than assumed, so a short answer can only narrow the scope.
 */
async function apiKeyCeilingCuts({
  apiKeyCeiling,
  userId,
  organizationId,
  projects,
}: {
  apiKeyCeiling: CallerApiKeyCeiling | undefined;
  userId: string | null;
  organizationId: string;
  projects: Array<{ id: string; teamId: string }>;
}): Promise<{
  viewable: (projectId: string) => boolean;
  priceable: (projectId: string) => boolean;
}> {
  if (!apiKeyCeiling || projects.length === 0) {
    const everything = () => true;
    return { viewable: everything, priceable: everything };
  }
  const decisions = await apiKeyCeiling.cuts({
    apiKeyId: apiKeyCeiling.apiKeyId,
    userId,
    organizationId,
    projects: projects.map((project) => ({
      projectId: project.id,
      teamId: project.teamId,
    })),
    permissions: ["traces:view", "cost:view"],
  });
  const allowedBy =
    (permission: "traces:view" | "cost:view") => (projectId: string) =>
      decisions.get(permission)?.get(projectId) === true;
  return {
    viewable: allowedBy("traces:view"),
    priceable: allowedBy("cost:view"),
  };
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
