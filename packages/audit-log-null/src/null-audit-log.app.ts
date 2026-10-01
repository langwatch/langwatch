import {
  AuditLogApi,
  type AuditLogHistoryEntry,
  type RecordedAuditLogEntry,
} from "@langwatch/audit-log-contract";

/** The audit log an installation without the Enterprise feature answers with. */
export class NullAuditLog implements AuditLogApi {
  static readonly contract = AuditLogApi;
  static readonly dependencies = {};

  private constructor() {}

  static create(_setup: Readonly<{ config: undefined }>): NullAuditLog {
    return new NullAuditLog();
  }

  async record(): Promise<RecordedAuditLogEntry> {
    return { id: "", occurredAt: 0 };
  }

  async hasRecordedSince(): Promise<boolean> {
    return false;
  }

  async listEntityHistory(): Promise<AuditLogHistoryEntry[]> {
    return [];
  }
}
