/**
 * Grant, Role and GroupMembership reads that only ever see live rows.
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
type GroupMemberships = Pick<Prisma.TransactionClient, "groupMembership">;

/**
 * The membership fence, and the reason it is a wrapper rather than a clause.
 *
 * A removal MARKS the row (ADR-125's prerequisite), so a read that forgets
 * `removedAt: null` returns memberships that ended — and since COLLECT unions
 * `{user} ∪ groups`, that hands the user every grant the group holds. It fails
 * OPEN, and it fails open in the one place nobody looks at twice.
 *
 * The predicate a caller writes still applies: `where` is spread FIRST, so the
 * fence wins any attempt to state `removedAt` in the caller's filter.
 *
 * Reads that deliberately want history — the ledger's own inventory of who
 * has been in a group, ended or not — use the client directly and say so.
 */
export function liveGroupMemberships(prisma: GroupMemberships) {
  return {
    findMany: <T extends Prisma.GroupMembershipFindManyArgs>(args?: T) =>
      prisma.groupMembership.findMany({
        ...args,
        where: { ...args?.where, removedAt: null },
      } as T),

    findFirst: <T extends Prisma.GroupMembershipFindFirstArgs>(args?: T) =>
      prisma.groupMembership.findFirst({
        ...args,
        where: { ...args?.where, removedAt: null },
      } as T),

    count: <T extends Prisma.GroupMembershipCountArgs>(args?: T) =>
      prisma.groupMembership.count({
        ...args,
        where: { ...args?.where, removedAt: null },
      } as T),
  };
}

/**
 * The same fence as a Prisma FILTER, for the reads that reach memberships
 * through a relation (`group: { members: { some: LIVE_MEMBERSHIP } }`) rather
 * than through the delegate. Written once so the two styles cannot disagree
 * about what "still a member" means.
 */
export const LIVE_MEMBERSHIP = { removedAt: null } as const;

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
