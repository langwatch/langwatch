import {
  AuditLogApi,
  type AuditLogApiContract,
  type AuditLogHistoryEntry,
} from "@langwatch/audit-log-contract";

/** The audit log an installation without the Enterprise feature answers with. */
export class NullAuditLog implements AuditLogApiContract {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};

  private constructor() {}

  static create(_setup: Readonly<{ config: undefined }>): NullAuditLog {
    return new NullAuditLog();
  }

  async record(): Promise<void> {
    return void 0;
  }

  async listEntityHistory(): Promise<AuditLogHistoryEntry[]> {
    return [];
  }
}
