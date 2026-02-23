import { TtlCache } from "~/server/utils/ttlCache";
import { prisma } from "~/server/db";

const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Cache: projectId -> organizationId. Avoids repeated DB lookups. */
const orgCache = new TtlCache<string>(TEN_MINUTES_MS);

/**
 * Resolves the organizationId for a given projectId.
 *
 * Checks the TTL cache first; falls back to a Prisma query.
 * Returns undefined for orphan projects (no team or no organization).
 */
export async function resolveOrganizationId(
  projectId: string,
): Promise<string | undefined> {
  const cached = orgCache.get(projectId);
  if (cached) {
    return cached;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });

  const organizationId = project?.team?.organizationId;
  if (organizationId) {
    orgCache.set(projectId, organizationId);
  }

  return organizationId ?? undefined;
}

/** Exposed for testing: clears the org cache. */
export function clearOrgCache(): void {
  orgCache.clear();
}
