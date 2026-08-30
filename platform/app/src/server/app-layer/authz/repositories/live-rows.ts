/**
 * Grant, Role, Group and GroupMembership reads that only ever see live rows.
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
type Groups = Pick<Prisma.TransactionClient, "group">;
type GroupMemberships = Pick<Prisma.TransactionClient, "groupMembership">;

/**
 * The group fence, and the reason it is a wrapper rather than a clause.
 *
 * Deleting a group MARKS it (`Group.deletedAt`), so that the memberships it
 * held — themselves kept as marked rows — survive the deletion instead of
 * being cascaded away with the group. That means a deleted group is still a
 * readable row, and a read that forgets `deletedAt: null` gets one back and
 * treats it as a group that still exists: it lists, it can be edited, and
 * every `RoleBinding` it carries still resolves. It fails OPEN, in the same
 * direction and for the same reason `liveGroupMemberships` does.
 *
 * The predicate a caller writes still applies: `where` is spread FIRST, so the
 * fence wins any attempt to state `deletedAt` in the caller's filter.
 *
 * Reads that deliberately want history — an access review asking what a group
 * granted before it was deleted — use the client directly and say so.
 */
export function liveGroups(prisma: Groups) {
  return {
    findMany: <T extends Prisma.GroupFindManyArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Array<Prisma.GroupGetPayload<T>>> =>
      prisma.group.findMany({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T) as never,

    findFirst: <T extends Prisma.GroupFindFirstArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Prisma.GroupGetPayload<T> | null> =>
      prisma.group.findFirst({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T) as never,

    /** `findUnique` still needs a unique field in `where`; the fence is an
     *  extra filter on top of it (Prisma's extended where-unique), so a
     *  deleted row answers null rather than being handed back by id. */
    findUnique: <T extends Prisma.GroupFindUniqueArgs>(
      args: T,
    ): Prisma.PrismaPromise<Prisma.GroupGetPayload<T> | null> =>
      prisma.group.findUnique({
        ...args,
        where: { ...args.where, deletedAt: null },
      } as T) as never,

    findUniqueOrThrow: <T extends Prisma.GroupFindUniqueOrThrowArgs>(
      args: T,
    ): Prisma.PrismaPromise<Prisma.GroupGetPayload<T>> =>
      prisma.group.findUniqueOrThrow({
        ...args,
        where: { ...args.where, deletedAt: null },
      } as T) as never,

    count: <T extends Prisma.GroupCountArgs>(args?: T) =>
      prisma.group.count({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T),
  };
}

/**
 * The same fence as a Prisma FILTER, for the reads that reach a group through
 * a relation (`group: { organizationId, ...LIVE_GROUP }`, or a `RoleBinding`
 * selected via `group: { members: { some: ... } }`) rather than through the
 * delegate. Written once so the two styles cannot disagree about what "still
 * a group" means.
 */
export const LIVE_GROUP = { deletedAt: null } as const;

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
    findMany: <T extends Prisma.GroupMembershipFindManyArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Array<Prisma.GroupMembershipGetPayload<T>>> =>
      prisma.groupMembership.findMany({
        ...args,
        where: { ...args?.where, removedAt: null },
      } as T) as never,

    findFirst: <T extends Prisma.GroupMembershipFindFirstArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Prisma.GroupMembershipGetPayload<T> | null> =>
      prisma.groupMembership.findFirst({
        ...args,
        where: { ...args?.where, removedAt: null },
      } as T) as never,

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
    findMany: <T extends Prisma.GrantFindManyArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Array<Prisma.GrantGetPayload<T>>> =>
      prisma.grant.findMany({
        ...args,
        where: { ...args?.where, revokedAt: null },
      } as T) as never,

    findFirst: <T extends Prisma.GrantFindFirstArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Prisma.GrantGetPayload<T> | null> =>
      prisma.grant.findFirst({
        ...args,
        where: { ...args?.where, revokedAt: null },
      } as T) as never,
  };
}

export function liveRoles(prisma: Roles) {
  return {
    findMany: <T extends Prisma.RoleFindManyArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Array<Prisma.RoleGetPayload<T>>> =>
      prisma.role.findMany({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T) as never,

    findFirst: <T extends Prisma.RoleFindFirstArgs>(
      args?: T,
    ): Prisma.PrismaPromise<Prisma.RoleGetPayload<T> | null> =>
      prisma.role.findFirst({
        ...args,
        where: { ...args?.where, deletedAt: null },
      } as T) as never,
  };
}
