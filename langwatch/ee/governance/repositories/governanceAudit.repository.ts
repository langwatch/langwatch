// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Repository for AuditLog writes from governance services. Wraps the
 * one-off `prisma.auditLog.create` shape that every governance
 * mutation emits, so service files don't carry the `tx.auditLog.create`
 * literal scattered across multiple action types.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

export class GovernanceAuditRepository {
  emit(
    client: Client,
    data: Prisma.AuditLogUncheckedCreateInput,
  ) {
    return client.auditLog.create({ data });
  }
}
