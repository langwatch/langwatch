import type { AdminWorkspaceKind } from "@langwatch/enterprise-governance-contract";
import { type PrismaClient } from "@langwatch/prisma-client/generated";

import {
  AdminWorkspaceViewAuditRepository,
  type AdminWorkspaceAuditRow,
} from "../admin-workspace-view-audit.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type AdminWorkspaceViewAuditDatabase = Pick<PrismaClient, "auditLog">;

export class PrismaAdminWorkspaceViewAuditRepository extends AdminWorkspaceViewAuditRepository {
  private constructor(private readonly prisma: AdminWorkspaceViewAuditDatabase) {
    super();
  }

  static create(
    database: AdminWorkspaceViewAuditDatabase,
  ): PrismaAdminWorkspaceViewAuditRepository {
    return new PrismaAdminWorkspaceViewAuditRepository(database);
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
