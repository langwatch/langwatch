// Reads only see live rows; revokes mark rather than delete to fail safely when exclusion omitted.
import type { AuthzDatabase } from "../authz-read.repository.ts";

type QueryArgs = Readonly<{
  where?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}>;

type LiveRowsDelegate = Readonly<{
  findMany: (args?: QueryArgs) => Promise<unknown[]>;
  findFirst: (args?: QueryArgs) => Promise<unknown>;
}>;

export function liveGrants(database: Pick<AuthzDatabase, "grant">): LiveRowsDelegate {
  return {
    findMany: (args: QueryArgs = {}) =>
      database.grant.findMany({
        ...args,
        where: { ...args?.where, revokedAt: null },
      }),

    findFirst: (args: QueryArgs = {}) =>
      database.grant.findFirst({
        ...args,
        where: { ...args?.where, revokedAt: null },
      }),
  };
}

/** Which of these grants a braid change replaced: any row, live or revoked, names it (ADR-201
 *  §2), so a replaced braid stays out after its replacement is removed. Indexed by
 *  `Grant_organizationId_replacesGrantId_idx`; revoked rows are read by id, never scanned. */
export async function findReplacedGrantIds({
  database,
  organizationId,
  grantIds,
}: {
  database: Pick<AuthzDatabase, "grant">;
  organizationId: string;
  grantIds: readonly string[];
}): Promise<Set<string>> {
  if (grantIds.length === 0) return new Set();
  const rows = (await database.grant.findMany({
    where: { organizationId, replacesGrantId: { in: [...new Set(grantIds)] } },
    select: { replacesGrantId: true },
  })) as { replacesGrantId: string | null }[];
  return new Set(rows.flatMap((row) => (row.replacesGrantId ? [row.replacesGrantId] : [])));
}

export function liveRoles(database: Pick<AuthzDatabase, "role">): LiveRowsDelegate {
  return {
    findMany: (args: QueryArgs = {}) =>
      database.role.findMany({
        ...args,
        where: { ...args?.where, deletedAt: null },
      }),

    findFirst: (args: QueryArgs = {}) =>
      database.role.findFirst({
        ...args,
        where: { ...args?.where, deletedAt: null },
      }),
  };
}
