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
