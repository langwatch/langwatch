export interface StorageAuditStateRow {
  organizationId: string;
  everAlarmedAt: Date | null;
  lastAlarmKind: string | null;
}

/**
 * Audit posture per org (ADR-039 Decision 7). Alarms are recorded here and
 * surfaced — never auto-corrected — and an org that has ever alarmed stays
 * on the daily audit tier permanently.
 */
export interface StorageAuditStateRepository {
  recordAlarm(params: {
    organizationId: string;
    kind: "fold" | "reference" | "gauge-drift";
    at: Date;
  }): Promise<void>;
  findByOrganization(params: {
    organizationId: string;
  }): Promise<StorageAuditStateRow | null>;
}
