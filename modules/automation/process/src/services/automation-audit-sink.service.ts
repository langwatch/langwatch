import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";

import type { AutomationAuditSink } from "../app/automation.app.ts";

/** {@link AutomationAuditSink} over the SAME audit trail every other mutation is recorded on. */
export class AutomationAuditSinkService implements AutomationAuditSink {
  static create(auditLog: AuditLogApi): AutomationAuditSinkService {
    return new AutomationAuditSinkService(auditLog);
  }

  private constructor(private readonly auditLog: AuditLogApi) {}

  async record(
    entry: Readonly<{ userId: string; projectId?: string; action: string; args?: unknown }>,
  ): Promise<void> {
    await this.auditLog.record({
      userId: entry.userId,
      ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
      action: entry.action,
      ...(entry.args === undefined ? {} : { args: entry.args as RecordAuditLogCommand["args"] }),
    });
  }
}
