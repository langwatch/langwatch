import { countMemberSeats } from "@langwatch/entitlement-contract";
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";
import {
  INVITE_STATUS,
  OrganizationUserRole,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
} from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { MemberSeatRepository } from "../member-seat.repository.ts";

/** Only what this repository needs, named so a caller never names Prisma's own types. */
type PrismaMemberSeatDatabase = PrismaClient | Prisma.TransactionClient;

/** An invitation's team assignments as stored; anything else reads as none. */
const teamAssignmentsSchema = z.array(
  z.looseObject({ teamId: z.string(), customRoleId: z.string().optional() }),
);
const permissionsSchema = z.array(z.string());

type Holder = Readonly<{ role: OrganizationUserRole; permissions: string[] | undefined }>;

/** Seat counts over organization's membership and invitation rows, via its shares (R-C1f, Q9). */
export class PrismaMemberSeatRepository implements MemberSeatRepository {
  static create(prisma: PrismaMemberSeatDatabase): PrismaMemberSeatRepository {
    return new PrismaMemberSeatRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaMemberSeatDatabase) {}

  async countMemberSeats({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats> {
    return countMemberSeats(await this.seatHolders(organizationId));
  }

  /** Every active membership and live invitation, with the custom-role permissions it carries. */
  private async seatHolders(organizationId: string): Promise<Holder[]> {
    // A disabled membership and a deactivated person hold no access, so they hold no seat
    // (seat-reconciliation.feature).
    const [users, customRoles, invites] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where: { organizationId, disabledAt: null, user: { deactivatedAt: null } },
        select: { userId: true, role: true },
      }),
      this.prisma.customRole.findMany({
        where: { organizationId },
        select: { id: true, permissions: true },
      }),
      this.prisma.organizationInvite.findMany({
        where: {
          organizationId,
          status: INVITE_STATUS.PENDING,
          OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
        },
        select: { role: true, teamAssignments: true },
      }),
    ]);
    const rolePermissions = new Map(
      customRoles.map((r) => [r.id, permissionsSchema.safeParse(r.permissions).data ?? []]),
    );
    const permissionsOf = (customRoleIds: readonly (string | null | undefined)[]) => {
      const merged = customRoleIds.flatMap((id) => (id ? (rolePermissions.get(id) ?? []) : []));
      return merged.length > 0 ? merged : undefined;
    };

    const externalPermissions = await this.externalPermissions({
      organizationId,
      userIds: users.filter((u) => u.role === OrganizationUserRole.EXTERNAL).map((u) => u.userId),
      permissionsOf,
    });

    return [
      ...users.map((u) => ({ role: u.role, permissions: externalPermissions.get(u.userId) })),
      ...invites.map((invite) => ({
        role: invite.role,
        permissions: permissionsOf(
          (teamAssignmentsSchema.safeParse(invite.teamAssignments).data ?? []).map(
            (assignment) => assignment.customRoleId,
          ),
        ),
      })),
    ];
  }

  /** An EXTERNAL member's permissions, merged from the custom roles their team bindings carry. */
  private async externalPermissions({
    organizationId,
    userIds,
    permissionsOf,
  }: Readonly<{
    organizationId: string;
    userIds: string[];
    permissionsOf: (customRoleIds: readonly (string | null | undefined)[]) => string[] | undefined;
  }>): Promise<Map<string, string[] | undefined>> {
    if (userIds.length === 0) return new Map();
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });
    if (teams.length === 0) return new Map();
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: { in: teams.map((t) => t.id) },
        userId: { in: userIds },
      },
      select: { userId: true, customRoleId: true },
    });
    return new Map(
      userIds.map((userId) => [
        userId,
        permissionsOf(bindings.filter((b) => b.userId === userId).map((b) => b.customRoleId)),
      ]),
    );
  }
}
