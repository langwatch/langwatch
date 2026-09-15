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
