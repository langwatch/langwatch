/**
 * Thin adapter writing governance rows to the shared AuditLog table using
 * the gateway shape (action enum, targetKind, before/after diff).
 * `actorUserId` passes through to keep attribution consistent with `auditLog()`.
 */
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type {
  GatewayAuditRepository,
  AppendGatewayAuditInput,
  GatewayAuditTransaction,
} from "../gateway-audit.repository.ts";

/** The client slice an audit row needs. */
type GatewayAuditDatabase = Pick<PrismaClient, "auditLog">;

export class PrismaGatewayAuditRepository implements GatewayAuditRepository {
  static create(database: GatewayAuditDatabase): PrismaGatewayAuditRepository {
    return new PrismaGatewayAuditRepository(database);
  }

  constructor(private readonly prisma: GatewayAuditDatabase) {}

  async append(
    input: AppendGatewayAuditInput,
    transaction?: GatewayAuditTransaction,
  ): Promise<void> {
    const client = transaction ? (transaction as Prisma.TransactionClient) : this.prisma;
    await client.auditLog.create({
      data: {
        userId: input.actorUserId,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        before: jsonInput(input.before),
        after: jsonInput(input.after),
      },
    });
  }
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return z.json().parse(value) as Prisma.InputJsonValue;
}
