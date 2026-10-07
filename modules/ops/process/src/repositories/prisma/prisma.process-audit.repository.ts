import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { ProcessAuditRepository } from "../ops-audit.repository.ts";

const TARGET_KIND = "process_instance";

/** Process-manager operator acts as the audit log holds them, newest first. */
export class PrismaProcessAuditRepository extends ProcessAuditRepository {
  static create({ prisma }: { prisma: PrismaClient }): PrismaProcessAuditRepository {
    return new PrismaProcessAuditRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { targetKind: TARGET_KIND },
      orderBy: { createdAt: "desc" },
      take: params.limit,
      select: {
        id: true,
        createdAt: true,
        action: true,
        targetId: true,
        userId: true,
        metadata: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.getTime(),
      action: r.action,
      targetId: r.targetId ?? "",
      actorUserId: r.userId,
      metadata: r.metadata,
    }));
  }
}
