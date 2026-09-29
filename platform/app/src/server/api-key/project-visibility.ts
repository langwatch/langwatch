import type { RoleBindingScopeType } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  resolveApiKeyPermission,
  resolveApiKeyPermissionProjectBatch,
} from "~/server/app-layer/authz/credential-permissions";
import { GrantsAuthzReadRepository } from "../app-layer/authz/repositories/authz-read.grants.repository";
import { ProjectVisibilityTooWideError } from "./errors";

/**
 * The projects a credential may list: everything in the organization, or an
 * explicit id set (possibly empty).
 */
export type VisibleProjects = { kind: "all" } | { kind: "some"; ids: string[] };

/** Lists live project grants intersected with the stored key owner’s current access. */
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

  const decisions = await resolveApiKeyPermissionProjectBatch({
    prisma,
    apiKeyId,
    userId,
    organizationId,
    projects: candidates.map(({ id, teamId }) => ({ projectId: id, teamId })),
    permissions: ["project:view"],
  });
  const visible = decisions.get("project:view");
  return {
    kind: "some",
    ids: candidates
      .filter(({ id }) => visible?.get(id) === true)
      .map(({ id }) => id),
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
  // No key, no bindings to read: Prisma drops an `undefined` from the filter,
  // which would widen this to every binding in the organization.
  if (!apiKeyId) return null;

  const bindings = await new GrantsAuthzReadRepository(
    prisma,
  ).findApiKeyBindings({
    organizationId,
    apiKeyId,
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
      (binding) => binding.scopeType === "ORGANIZATION",
    ),
    teamIds: idsOfType("TEAM"),
    projectIds: idsOfType("PROJECT"),
  };
}

/**
 * The most projects one visibility resolution will carry.
 *
 * An org-bound key whose owner has lost org-wide `project:view` cannot be
 * answered from the fast path: the reach is "every project in the
 * organization, minus what the owner can no longer see", so the candidates
 * have to be enumerated. The cap bounds that work. It is not a silent
 * truncation — going over it refuses the request, because a short list would
 * be a wrong answer rather than a slow one.
 */
const MAX_CANDIDATE_PROJECTS = 5_000;

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
  const candidates = await findCandidates({ prisma, organizationId, bound });
  if (candidates.length > MAX_CANDIDATE_PROJECTS) {
    throw new ProjectVisibilityTooWideError(
      `Resolving this credential's project visibility would scan more than ${MAX_CANDIDATE_PROJECTS} projects`,
      { meta: { organizationId, limit: MAX_CANDIDATE_PROJECTS } },
    );
  }
  return candidates;
}

async function findCandidates({
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
    // One over the cap: enough to know it was exceeded, without reading an
    // unbounded row set to find out.
    take: MAX_CANDIDATE_PROJECTS + 1,
  });
}
