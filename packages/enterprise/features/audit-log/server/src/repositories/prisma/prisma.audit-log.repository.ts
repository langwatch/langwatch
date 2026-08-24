import type { AuditLogEntry } from "@langwatch/enterprise-audit-log-contract";
import { AuditLogRepository } from "../audit-log.repository";

export type AuditLogPrismaClient = {
  auditLog: {
    create(input: { data: AuditLogEntry }): Promise<unknown>;
  };
};

export class PrismaAuditLogRepository extends AuditLogRepository {
  private constructor(private readonly client: AuditLogPrismaClient) {
    super();
  }

  static create(client: AuditLogPrismaClient): PrismaAuditLogRepository {
    return new PrismaAuditLogRepository(client);
  }

  async create(entry: AuditLogEntry): Promise<void> {
    await this.client.auditLog.create({ data: entry });
  }
}
