import type { Prisma, PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Resolve the single organization a (scopeType, scopeId) target belongs to.
 *
 * Scoping is always within one organization (ADR-021), so every scope target
 * maps to exactly one org: an ORGANIZATION scope is the org itself, a TEAM
 * scope resolves through the team, and a PROJECT scope through the project's
 * team. Returns `null` when the referenced entity does not exist (an orphaned
 * scope) so callers can decide whether to skip, delete, or reject the row.
 *
 * This is the one home for the scope -> organization mapping; resolvers that
 * need a hard guarantee wrap it and throw on null.
 */
export async function resolveOrganizationForScope(
  client: Client,
  scope: { scopeType: string; scopeId: string },
): Promise<string | null> {
  if (scope.scopeType === "ORGANIZATION") {
    return scope.scopeId;
  }
  if (scope.scopeType === "TEAM") {
    const team = await client.team.findUnique({
      where: { id: scope.scopeId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }
  const project = await client.project.findUnique({
    where: { id: scope.scopeId },
    select: { team: { select: { organizationId: true } } },
  });
  return project?.team.organizationId ?? null;
}

/**
 * Resolve the single organization a set of scope targets all belong to, for
 * resources anchored to one org (ADR-021). Every scope must resolve, and they
 * must all resolve to the same organization; otherwise we'd persist scope rows
 * that disagree with the row's organizationId anchor. Throws on an empty,
 * unresolvable, or cross-organization set. `resourceLabel` is woven into the
 * error message (e.g. "model provider").
 */
export async function resolveSingleOrganizationForScopes(
  client: Client,
  scopes: { scopeType: string; scopeId: string }[],
  resourceLabel: string,
): Promise<string> {
  if (scopes.length === 0) {
    throw new Error(
      `Cannot create ${resourceLabel}: at least one scope is required to resolve an organization`,
    );
  }
  const resolved = await Promise.all(
    scopes.map((scope) => resolveOrganizationForScope(client, scope)),
  );
  const organizationId = resolved[0];
  if (!organizationId || resolved.some((orgId) => orgId !== organizationId)) {
    throw new Error(
      `Cannot create ${resourceLabel}: all scopes must resolve to the same organization`,
    );
  }
  return organizationId;
}
