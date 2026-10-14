import { type AuditLogApi, auditLogJsonValueSchema } from "@langwatch/audit-log-contract";
import type { AdminAuditRequest } from "@langwatch/ops-contract";

import { AdminAuditSink } from "./impersonation.service.ts";

/** Records impersonation and Back office acts on the shared audit log. */
export class AdminAuditService extends AdminAuditSink {
  static create({ auditLog }: { auditLog: Pick<AuditLogApi, "record"> }): AdminAuditService {
    return new AdminAuditService(auditLog);
  }

  private constructor(private readonly auditLog: Pick<AuditLogApi, "record">) {
    super();
  }

  async record(entry: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
    req: AdminAuditRequest;
  }): Promise<void> {
    const userAgent = AdminAuditService.firstHeader(entry.req.headers["user-agent"]);
    await this.auditLog.record({
      userId: entry.userId,
      action: entry.action,
      // A JSON round trip turns dates into strings and drops undefined fields.
      args: auditLogJsonValueSchema.parse(JSON.parse(JSON.stringify(entry.args))),
      ...(entry.req.remoteAddress ? { ipAddress: entry.req.remoteAddress } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
  }

  private static firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
