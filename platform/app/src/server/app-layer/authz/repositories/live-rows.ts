/**
 * Grant and Role reads that only ever see live rows.
 *
 * A revoke marks its row rather than deleting it, so every read that decides
 * or lists access has to exclude the marked ones — and leaving that clause
 * out fails OPEN, which is the worst direction for a mistake nobody can see
 * in a diff.
 *
 * So the fence is not a clause each query remembers; it is the only way these
 * repositories reach the tables. `liveGrants(prisma).findMany({ where })`
 * cannot be written without it.
 *
 * Reads that deliberately want history — the migration's inventory of what an
 * organization has held, ended or not — use the client directly and say so.
 */
import type { Prisma } from "~/generated/prisma/client";

type Grants = Pick<Prisma.TransactionClient, "grant">;
type Roles = Pick<Prisma.TransactionClient, "role">;

export function liveGrants(prisma: Grants) {
  return {
    findMany: <T extends Prisma.GrantFindManyArgs>(args?: T) =>
      prisma.grant.findMany({
        ...args,
        where: { ...args?.where, revokedAt: null },
      } as T),

    findFirst: <T extends Prisma.GrantFindFirstArgs>(args?: T) =>
      prisma.grant.findFirst({
        ...args,
        where: { ...args?.where, revokedAt: null },
      } as T),
  };
}

export function liveRoles(prisma: Roles) {
  return {
    findMany: <T extends Prisma.RoleFindManyArgs>(args?: T) =>
      prisma.role.findMany({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T),

    findFirst: <T extends Prisma.RoleFindFirstArgs>(args?: T) =>
      prisma.role.findFirst({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T),
  };
}
