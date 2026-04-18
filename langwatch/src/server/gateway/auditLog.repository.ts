/**
 * GatewayAuditLog is the append-only ledger of every gateway-surface
 * mutation. Written in the same transaction as the mutation it audits.
 */
import { Prisma, type GatewayAuditAction, type PrismaClient } from "@prisma/client";

export type AppendAuditInput = {
  organizationId: string;
  projectId?: string | null;
  actorUserId?: string | null;
  action: GatewayAuditAction;
  targetKind: "virtual_key" | "budget" | "provider_binding";
  targetId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

export class GatewayAuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    input: AppendAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.gatewayAuditLog.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        before: input.before ?? Prisma.JsonNull,
        after: input.after ?? Prisma.JsonNull,
      },
    });
  }
}
