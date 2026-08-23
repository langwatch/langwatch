/**
 * Grant and Role reads that only ever see live rows.
 *
 * A revoke marks its row rather than deleting it, so every read that decides
 * or lists access has to exclude the marked ones — and leaving that clause
 * out fails OPEN, which is the worst direction for a mistake nobody can see
 * in a diff.
 *
 * So the fence is not a clause each query remembers; it is the only way these
 * repositories reach the tables. `liveGrants(database).findMany({ where })`
 * cannot be written without it.
 *
 * Reads that deliberately want history — the migration's inventory of what an
 * organization has held, ended or not — use the client directly and say so.
 */
import type { AuthzDatabase } from "../authz-read.repository";

type QueryArgs = Readonly<{
  where?: Readonly<Record<string, unknown>>;
  [key: string]: unknown;
}>;

export function liveGrants(database: Pick<AuthzDatabase, "grant">) {
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

export function liveRoles(database: Pick<AuthzDatabase, "role">) {
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
