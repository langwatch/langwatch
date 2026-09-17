import { AuditLogApi } from "@langwatch/audit-log-contract";
import { auditLogServer } from "@langwatch/enterprise-audit-log-server";
import { createProcessApp } from "@langwatch/kernel";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

const DEFAULT_MAX_ARGS_BYTES = 4 * 1024;

/** The real audit log, booted over this deployment's own connection. */
export class EnterpriseWorkerAuditLog {
  private constructor(
    private readonly api: AuditLogApi,
    private readonly close: () => Promise<void>,
  ) {}

  static async create(options: {
    prisma: PrismaClient;
    maxArgsBytes?: number;
  }): Promise<EnterpriseWorkerAuditLog> {
    const runtime = await createProcessApp({ role: "worker" })
      .withModules([auditLogServer])
      .withConfig({
        "audit-log": { maxArgsBytes: options.maxArgsBytes ?? DEFAULT_MAX_ARGS_BYTES },
      })
      .withRelational(options.prisma)
      .boot();

    return new EnterpriseWorkerAuditLog(runtime.service(AuditLogApi), () => runtime.stop());
  }

  auditLog(): AuditLogApi {
    return this.api;
  }

  stop(): Promise<void> {
    return this.close();
  }
}
