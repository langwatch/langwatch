/**
 * Read-side service for GatewayAuditLog. The repository writes; this
 * service reads.
 *
 * List queries are paginated via (createdAt DESC, id DESC) cursor so the
 * UI can scroll through history without skipping rows that land in the
 * same millisecond (happens when a batched mutation writes multiple
 * entries in a single transaction).
 */
import type {
  GatewayAuditAction,
  GatewayAuditLog,
  PrismaClient,
  User,
} from "@prisma/client";

export type AuditListFilters = {
  organizationId: string;
  action?: GatewayAuditAction;
  targetKind?: "virtual_key" | "budget" | "provider_binding";
  targetId?: string;
  actorUserId?: string;
  fromDate?: Date;
  toDate?: Date;
};

export type AuditListPagination = {
  limit: number;
  cursor?: { createdAt: Date; id: string } | null;
};

export type AuditLogEntry = GatewayAuditLog & {
  actor: Pick<User, "id" | "name" | "email"> | null;
};

export type AuditListPage = {
  entries: AuditLogEntry[];
  nextCursor: { createdAt: string; id: string } | null;
};

export class GatewayAuditService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): GatewayAuditService {
    return new GatewayAuditService(prisma);
  }

  async list(
    filters: AuditListFilters,
    pagination: AuditListPagination,
  ): Promise<AuditListPage> {
    const limit = Math.min(Math.max(pagination.limit, 1), 200);
    const cursor = pagination.cursor ?? null;

    const rows = await this.prisma.gatewayAuditLog.findMany({
      where: {
        organizationId: filters.organizationId,
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.targetKind ? { targetKind: filters.targetKind } : {}),
        ...(filters.targetId ? { targetId: filters.targetId } : {}),
        ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
        ...(filters.fromDate || filters.toDate
          ? {
              createdAt: {
                ...(filters.fromDate ? { gte: filters.fromDate } : {}),
                ...(filters.toDate ? { lt: filters.toDate } : {}),
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  AND: [
                    { createdAt: cursor.createdAt },
                    { id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
    });

    let nextCursor: AuditListPage["nextCursor"] = null;
    if (rows.length > limit) {
      const overflow = rows.pop();
      if (overflow) {
        nextCursor = {
          createdAt: overflow.createdAt.toISOString(),
          id: overflow.id,
        };
      }
    }

    return { entries: rows, nextCursor };
  }
}
