import type { PrismaClient } from "~/generated/prisma/client";
import { RoleBindingScopeType } from "~/generated/prisma/client";
import { batchScopePermissions } from "~/server/api/rbac";
import {
  checkRoleBindingPermission,
  resolveApiKeyPermission,
} from "~/server/rbac/role-binding-resolver";

/**
 * The projects a credential may list: everything in the organization, or an
 * explicit id set (possibly empty).
 */
export type VisibleProjects = { kind: "all" } | { kind: "some"; ids: string[] };

/**
 * Which projects an organization-scoped API key credential holds
 * `project:view` on.
 *
 * The answer `GET /api/projects` filters by: a credential whose reach covers
 * the whole organization keeps the full listing, anything narrower gets
 * exactly the projects where key bindings ∩ owner ceiling grant the view —
 * through the resolvers on both heads, never raw grant walks.
 *
 * Shaped to avoid the per-project resolver loop:
 *   1. one org-scope `resolveApiKeyPermission` answers the unchanged fast
 *      path (both heads, ceiling included);
 *   2. the key's bindings enumerate the CANDIDATE projects (org binding →
 *      all, team binding → that team's projects, project binding → itself);
 *   3. the key head is asked once per binding scope via
 *      `checkRoleBindingPermission`, all scopes concurrently;
 *   4. the owner ceiling is applied over all candidates in one
 *      `batchScopePermissions` round.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
export async function resolveVisibleProjects({
  prisma,
  apiKeyId,
  userId,
  organizationId,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  /** The key's owner; null for service keys, which have no owner ceiling. */
  userId: string | null;
  organizationId: string;
}): Promise<VisibleProjects> {
  const orgWide = await resolveApiKeyPermission({
    prisma,
    apiKeyId,
    userId,
    organizationId,
    scope: { type: "org", id: organizationId },
    permission: "project:view",
  });
  if (orgWide) return { kind: "all" };

  const bound = await boundScopes({ prisma, apiKeyId, organizationId });
  if (!bound) return { kind: "some", ids: [] };

  const candidates = await candidateProjects({
    prisma,
    organizationId,
    bound,
  });
  if (candidates.length === 0) return { kind: "some", ids: [] };

  const keyVisible = await projectsTheKeyGrants({
    prisma,
    apiKeyId,
    organizationId,
    bound,
    candidates,
  });
  if (keyVisible.length === 0) return { kind: "some", ids: [] };

  // A service key has no owner ceiling; the key head is the whole answer.
  if (!userId) {
    return { kind: "some", ids: keyVisible.map((project) => project.id) };
  }

  return {
    kind: "some",
    ids: await narrowToOwnerCeiling({
      prisma,
      userId,
      organizationId,
      projects: keyVisible,
    }),
  };
}

type CandidateProject = { id: string; teamId: string };

type BoundScopes = {
  hasOrgBinding: boolean;
  teamIds: string[];
  projectIds: string[];
};

/**
 * Phase 2: the scopes the key's own bindings name, as candidate enumeration
 * only — every grant DECISION is taken by a resolver later. `null` means the
 * key has no bindings at all, so it can see nothing.
 */
async function boundScopes({
  prisma,
  apiKeyId,
  organizationId,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  organizationId: string;
}): Promise<BoundScopes | null> {
  const bindings = await prisma.roleBinding.findMany({
    where: { organizationId, apiKeyId },
    select: { scopeType: true, scopeId: true },
  });
  if (bindings.length === 0) return null;

  const idsOfType = (scopeType: RoleBindingScopeType) => [
    ...new Set(
      bindings
        .filter((binding) => binding.scopeType === scopeType)
        .map((binding) => binding.scopeId),
    ),
  ];
  return {
    hasOrgBinding: bindings.some(
      (binding) => binding.scopeType === RoleBindingScopeType.ORGANIZATION,
    ),
    teamIds: idsOfType(RoleBindingScopeType.TEAM),
    projectIds: idsOfType(RoleBindingScopeType.PROJECT),
  };
}

/** Phase 2b: the non-archived projects those bound scopes can reach. */
async function candidateProjects({
  prisma,
  organizationId,
  bound,
}: {
  prisma: PrismaClient;
  organizationId: string;
  bound: BoundScopes;
}): Promise<CandidateProject[]> {
  return prisma.project.findMany({
    where: {
      archivedAt: null,
      team: { organizationId },
      ...(bound.hasOrgBinding
        ? {}
        : {
            OR: [
              ...(bound.projectIds.length > 0
                ? [{ id: { in: bound.projectIds } }]
                : []),
              ...(bound.teamIds.length > 0
                ? [{ teamId: { in: bound.teamIds } }]
                : []),
            ],
          }),
    },
    select: { id: true, teamId: true },
  });
}

/**
 * Phase 3: the key head, asked once per binding scope rather than once per
 * project. The scope checks are independent reads, so they run concurrently.
 */
async function projectsTheKeyGrants({
  prisma,
  apiKeyId,
  organizationId,
  bound,
  candidates,
}: {
  prisma: PrismaClient;
  apiKeyId: string;
  organizationId: string;
  bound: BoundScopes;
  candidates: CandidateProject[];
}): Promise<CandidateProject[]> {
  const principal = { type: "apiKey" as const, id: apiKeyId };
  const grants = (
    scope: Parameters<typeof checkRoleBindingPermission>[0]["scope"],
  ) =>
    checkRoleBindingPermission({
      prisma,
      principal,
      organizationId,
      scope,
      permission: "project:view",
    });

  const candidateById = new Map(
    candidates.map((project) => [project.id, project]),
  );
  const boundProjects = bound.projectIds
    .map((projectId) => candidateById.get(projectId))
    .filter((project): project is CandidateProject => !!project);

  const [orgWide, teamResults, projectResults] = await Promise.all([
    bound.hasOrgBinding
      ? grants({ type: "org", id: organizationId })
      : Promise.resolve(false),
    Promise.all(
      bound.teamIds.map(async (teamId) => ({
        teamId,
        granted: await grants({ type: "team", id: teamId }),
      })),
    ),
    Promise.all(
      boundProjects.map(async (project) => ({
        projectId: project.id,
        granted: await grants({
          type: "project",
          id: project.id,
          teamId: project.teamId,
        }),
      })),
    ),
  ]);

  if (orgWide) return candidates;
  const keyTeams = new Set(
    teamResults.filter((r) => r.granted).map((r) => r.teamId),
  );
  const keyProjects = new Set(
    projectResults.filter((r) => r.granted).map((r) => r.projectId),
  );
  return candidates.filter(
    (project) => keyTeams.has(project.teamId) || keyProjects.has(project.id),
  );
}

/** Phase 4: the owner ceiling, over all candidates in one batch round. */
async function narrowToOwnerCeiling({
  prisma,
  userId,
  organizationId,
  projects,
}: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  projects: CandidateProject[];
}): Promise<string[]> {
  const owner = await batchScopePermissions(
    { prisma, session: ownerSession(userId) },
    {
      organizationId,
      teamIds: [],
      projectIds: projects.map((project) => project.id),
      projectTeamId: Object.fromEntries(
        projects.map((project) => [project.id, project.teamId]),
      ),
      permission: "project:view",
    },
  );
  return projects
    .filter((project) => owner.projects.get(project.id) === true)
    .map((project) => project.id);
}

/**
 * The minimal session shape the batch resolver reads; only `user.id` is ever
 * accessed (same shape `PermissionService` passes).
 */
function ownerSession(userId: string) {
  return { user: { id: userId } } as Parameters<
    typeof batchScopePermissions
  >[0]["session"];
}
