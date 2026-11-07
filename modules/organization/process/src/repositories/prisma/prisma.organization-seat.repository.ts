import { countMemberSeats, isFullMember } from "@langwatch/entitlement-contract";
import {
  type OrganizationMemberSeats,
  SeatChangeBusyError,
} from "@langwatch/organization-contract";
import {
  acquireLease,
  LEASE_TTL_MS,
  type LeaseStore,
  RENEW_EVERY_MS,
  withLease,
} from "@langwatch/prisma-client";
import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import { z } from "zod";

import { OrganizationSeatRepository, type SeatLease } from "../organization-seat.repository.ts";

/** Only what this repository needs, named so a caller never names Prisma's own types. */
type PrismaOrganizationSeatDatabase = PrismaClient | Prisma.TransactionClient;

/** A lease written inside a caller's transaction would stay invisible until it commits. */
function isRootClient(database: PrismaOrganizationSeatDatabase): database is PrismaClient {
  return "$transaction" in database;
}

/** The organization's seat lease row: taken when free or expired, renewed, then dropped. */
function seatLeaseStore({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): LeaseStore {
  return {
    acquire: async ({ holder, ttlMs }) => {
      const taken = await prisma.$queryRaw<{ holder: string }[]>`
INSERT INTO "OrganizationSeatLease" ("organizationId", "holder", "expiresAt")
VALUES (${organizationId}, ${holder}, now() + make_interval(secs => ${ttlMs / 1000}))
ON CONFLICT ("organizationId") DO UPDATE
  SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
  WHERE "OrganizationSeatLease"."expiresAt" < now()
RETURNING "holder"`;
      return taken.length > 0;
    },
    renew: async ({ holder, ttlMs }) => {
      const renewed = await prisma.$executeRaw`
UPDATE "OrganizationSeatLease" SET "expiresAt" = now() + make_interval(secs => ${ttlMs / 1000})
WHERE "organizationId" = ${organizationId} AND "holder" = ${holder}`;
      return renewed > 0;
    },
    release: async ({ holder }) => {
      await prisma.organizationSeatLease.deleteMany({ where: { organizationId, holder } });
    },
  };
}

/** An invitation's team assignments as stored; anything else reads as none. */
const teamAssignmentsSchema = z.array(
  z.looseObject({
    teamId: z.string(),
    role: z.string().optional(),
    customRoleId: z.string().optional(),
  }),
);
type TeamAssignment = z.infer<typeof teamAssignmentsSchema>[number];

const permissionsSchema = z.array(z.string());

/**
 * Context data needed for member classification.
 * Fetched once and shared between getMemberCount and getMembersLiteCount.
 */
interface MemberClassificationContext {
  users: { userId: string; role: OrganizationUserRole }[];
  customRoleMap: Map<string, string[]>;
  userPermissionsMap: Map<string, string[]>;
  pendingInvites: {
    role: OrganizationUserRole;
    email: string;
    teamAssignments: TeamAssignment[] | null;
  }[];
}

/** Seat counts over organization's own membership and invitation rows. */
export class PrismaOrganizationSeatRepository extends OrganizationSeatRepository {
  /** The seat lease is this repository's own row; the counts read membership's. */
  static readonly tables = prismaTables("OrganizationSeatLease");

  static create(prisma: PrismaOrganizationSeatDatabase): PrismaOrganizationSeatRepository {
    return new PrismaOrganizationSeatRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaOrganizationSeatDatabase) {
    super();
  }

  /**
   * Counts full members: ADMIN/MEMBER role, EXTERNAL role with a non-view custom role, or a
   * matching PENDING invite.
   */
  async getMemberCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).fullMembers;
  }

  /**
   * Counts Lite Member users: EXTERNAL role with no custom role (or a
   * view-only one), plus PENDING invites meeting the same criteria (not
   * expired, or no expiration).
   */
  async getMembersLiteCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).liteMembers;
  }

  /**
   * Counts Developer seats (ADR-171): DEVELOPER users plus live PENDING
   * DEVELOPER invites. Shown on the plan page, never compared to a limit.
   */
  async getMembersDeveloperCount(organizationId: string): Promise<number> {
    return (await this.countMemberSeats(organizationId)).developers;
  }

  /** The organization's lease row, holding no connection while `work` runs (withLease). */
  async withSeatLock<T>({
    organizationId,
    work,
  }: {
    organizationId: string;
    work: (lease: SeatLease) => Promise<T>;
  }): Promise<T> {
    return withLease({
      store: this.leaseStore(organizationId),
      work,
      onBusy: () => new SeatChangeBusyError(),
      onLost: () => new SeatChangeBusyError(),
    });
  }

  async acquireSeatLease({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ holder: string; renewEveryMs: number }> {
    const holder = await acquireLease({
      store: this.leaseStore(organizationId),
      onBusy: () => new SeatChangeBusyError(),
    });
    return { holder, renewEveryMs: RENEW_EVERY_MS };
  }

  renewSeatLease({
    organizationId,
    holder,
  }: {
    organizationId: string;
    holder: string;
  }): Promise<boolean> {
    return this.leaseStore(organizationId).renew({ holder, ttlMs: LEASE_TTL_MS });
  }

  releaseSeatLease({
    organizationId,
    holder,
  }: {
    organizationId: string;
    holder: string;
  }): Promise<void> {
    return this.leaseStore(organizationId).release({ holder });
  }

  private leaseStore(organizationId: string): LeaseStore {
    if (!isRootClient(this.prisma)) {
      throw new Error("The seat lease needs the root client, not a transaction");
    }
    return seatLeaseStore({ prisma: this.prisma, organizationId });
  }

  /** Every seat in one read: full, lite and Developer, live invitations included. */
  async countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats> {
    const context = await this.getMemberClassificationContext(organizationId);
    // A full seat stays counted until its hold ends (seat-rotation.feature).
    const holds = await this.prisma.seatHold.findMany({
      where: { organizationId, heldUntil: { gt: new Date() } },
      select: { userId: true, email: true },
    });
    return countMemberSeats(
      [
        ...context.users.map((user) => ({
          role: user.role,
          permissions: context.userPermissionsMap.get(user.userId),
          userId: user.userId,
        })),
        ...context.pendingInvites.map((invite) => ({
          role: invite.role,
          email: invite.email,
          permissions: this.getInvitePermissions(invite.teamAssignments, context.customRoleMap),
        })),
      ],
      holds,
    );
  }

  async findFullSeatHolderIds(organizationId: string): Promise<string[]> {
    const context = await this.getMemberClassificationContext(organizationId);
    return context.users
      .filter((user) => isFullMember(user.role, context.userPermissionsMap.get(user.userId)))
      .map((user) => user.userId);
  }

  /**
   * Fetches all data needed for member classification.
   * Shared between getMemberCount and getMembersLiteCount.
   */
  private async getMemberClassificationContext(
    organizationId: string,
  ): Promise<MemberClassificationContext> {
    // A disabled membership and a deactivated person hold no access, so they
    // hold no seat: billing for them would be charging for a locked door.
    // See seat-reconciliation.feature.
    const users = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null, user: { deactivatedAt: null } },
      select: { userId: true, role: true },
    });

    const customRoleMap = await this.getCustomRoleMap(organizationId);
    const userPermissionsMap = await this.getUserPermissionsMap(
      organizationId,
      users,
      customRoleMap,
    );

    const pendingInvites = await this.prisma.organizationInvite.findMany({
      where: {
        organizationId,
        status: INVITE_STATUS.PENDING,
        OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
      },
      select: { role: true, teamAssignments: true, email: true },
    });

    return {
      users,
      customRoleMap,
      userPermissionsMap,
      pendingInvites: pendingInvites.map((i) => ({
        role: i.role,
        email: i.email,
        teamAssignments: teamAssignmentsSchema.safeParse(i.teamAssignments).data ?? null,
      })),
    };
  }

  /**
   * Gets custom roles and their permissions for an organization.
   */
  private async getCustomRoleMap(organizationId: string): Promise<Map<string, string[]>> {
    const customRoles = await this.prisma.customRole.findMany({
      where: { organizationId },
      select: { id: true, permissions: true },
    });
    return new Map(
      customRoles.map((r) => [r.id, permissionsSchema.safeParse(r.permissions).data ?? []]),
    );
  }

  /**
   * Builds a map of user ID to their merged permissions from team assignments.
   */
  private async getUserPermissionsMap(
    organizationId: string,
    users: { userId: string; role: OrganizationUserRole }[],
    customRoleMap: Map<string, string[]>,
  ): Promise<Map<string, string[]>> {
    const externalUserIds = users
      .filter((u) => u.role === OrganizationUserRole.EXTERNAL)
      .map((u) => u.userId);

    if (externalUserIds.length === 0) {
      return new Map();
    }

    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });

    if (teams.length === 0) {
      return new Map();
    }

    const teamIds = teams.map((t) => t.id);
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: teamIds },
        userId: { in: externalUserIds },
      },
      select: { userId: true, customRoleId: true },
    });

    const userPermissionsMap = new Map<string, string[]>();
    for (const binding of bindings) {
      if (binding.customRoleId && binding.userId) {
        const permissions = customRoleMap.get(binding.customRoleId);
        if (permissions) {
          const existing = userPermissionsMap.get(binding.userId) ?? [];
          userPermissionsMap.set(binding.userId, [...existing, ...permissions]);
        }
      }
    }

    return userPermissionsMap;
  }

  /**
   * Gets merged permissions from invite team assignments.
   */
  private getInvitePermissions(
    teamAssignments: TeamAssignment[] | null,
    customRoleMap: Map<string, string[]>,
  ): string[] | undefined {
    if (!teamAssignments) {
      return undefined;
    }

    const allPermissions: string[] = [];
    for (const assignment of teamAssignments) {
      if (assignment.customRoleId) {
        const permissions = customRoleMap.get(assignment.customRoleId);
        if (permissions) {
          allPermissions.push(...permissions);
        }
      }
    }

    return allPermissions.length > 0 ? allPermissions : undefined;
  }
}
