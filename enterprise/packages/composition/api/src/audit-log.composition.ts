import { AuditLogApi } from "@langwatch/audit-log-contract";
import { auditLogServer } from "@langwatch/enterprise-audit-log-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";

const DEFAULT_MAX_ARGS_BYTES = 4 * 1024;

/** The real audit log, booted over this deployment's own connection. */
export class EnterpriseApiAuditLog {
  private constructor(
    private readonly api: AuditLogApi,
    private readonly close: () => Promise<void>,
  ) {}

  static async create(options: {
    prisma: PrismaClient;
    maxArgsBytes?: number;
  }): Promise<EnterpriseApiAuditLog> {
    const runtime = await createApp({ role: "api", config: {} })
      .withModules([withMemoryRepositories(auditLogServer)])
      .boot({
        role: "api",
        config: { "audit-log": { maxArgsBytes: options.maxArgsBytes ?? DEFAULT_MAX_ARGS_BYTES } },
      });

    return new EnterpriseApiAuditLog(runtime.service(AuditLogApi), () => runtime.stop());
  }

  auditLog(): AuditLogApi {
    return this.api;
  }

  stop(): Promise<void> {
    return this.close();
  }
}
