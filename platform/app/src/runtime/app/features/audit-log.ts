import {
  AuditLogAdapter,
  type LegacyAuditLogInput,
} from "@langwatch/enterprise-audit-log-server";

export class AppAuditLogRuntime {
  private static adapter: AuditLogAdapter | undefined;

  static install(input: { prisma: unknown; maxArgsBytes?: number }): void {
    AppAuditLogRuntime.adapter = AuditLogAdapter.create(input);
  }

  static clear(): void {
    AppAuditLogRuntime.adapter = undefined;
  }

  static async record(input: LegacyAuditLogInput): Promise<void> {
    if (!AppAuditLogRuntime.adapter) {
      throw new Error("AppAuditLogRuntime has not been installed");
    }
    await AppAuditLogRuntime.adapter.record(input);
  }
}

export const auditLog = (input: LegacyAuditLogInput): Promise<void> =>
  AppAuditLogRuntime.record(input);
