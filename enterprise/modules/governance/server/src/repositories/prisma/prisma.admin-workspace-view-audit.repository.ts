import { type PrismaClient } from "@langwatch/prisma-client/generated";
import type { AdminWorkspaceKind } from "@langwatch/enterprise-governance-contract";
import {
  AdminWorkspaceViewAuditRepository,
  type AdminWorkspaceAuditRow,
  type AdminWorkspaceTarget,
} from "../audit/admin-workspace-view-audit.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type AdminWorkspaceViewAuditDatabase = Pick<PrismaClient, "auditLog" | "team">;

export class PrismaAdminWorkspaceViewAuditRepository extends AdminWorkspaceViewAuditRepository {
  private constructor(private readonly prisma: AdminWorkspaceViewAuditDatabase) {
    super();
  }

  static create(
    database: AdminWorkspaceViewAuditDatabase,
  ): PrismaAdminWorkspaceViewAuditRepository {
    return new PrismaAdminWorkspaceViewAuditRepository(database);
  }

  async findTarget(input: {
    teamId: string;
    actorUserId: string;
  }): Promise<AdminWorkspaceTarget | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: input.teamId },
      select: {
        id: true,
        organizationId: true,
        ownerUserId: true,
        isPersonal: true,
        name: true,
        members: {
          where: { userId: input.actorUserId },
          select: { userId: true },
        },
      },
    });
    return team
      ? {
          id: team.id,
          organizationId: team.organizationId,
          ownerUserId: team.ownerUserId,
          isPersonal: team.isPersonal,
          name: team.name,
          actorIsMember: team.members.length > 0,
        }
      : null;
  }

  async findRecent(input: {
    actorUserId: string;
    targetKind: string;
    targetId: string;
    sinceMs: number;
  }): Promise<boolean> {
    const recent = await this.prisma.auditLog.findFirst({
      where: {
        userId: input.actorUserId,
        action: "governance.viewWorkspaceAs",
        targetKind: input.targetKind,
        targetId: input.targetId,
        createdAt: { gte: new Date(input.sinceMs) },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  async create(input: {
    actorUserId: string;
    organizationId: string;
    targetKind: string;
    targetId: string;
    metadata: { kind: AdminWorkspaceKind; workspaceLabel: string };
  }): Promise<AdminWorkspaceAuditRow> {
    const row = await this.prisma.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        action: "governance.viewWorkspaceAs",
        targetKind: input.targetKind,
        targetId: input.targetId,
        metadata: input.metadata,
      },
      select: { id: true, createdAt: true },
    });
    return { id: row.id, createdAtMs: row.createdAt.getTime() };
  }
}
