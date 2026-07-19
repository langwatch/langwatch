export interface AutomationAuditRow {
  tenantId: string;
  eventId: string;
  triggerId: string;
  traceId: string;
  actionClass: "notify" | "persist";
  occurredAtMs: number;
}

export interface AutomationAuditRepository {
  insert(row: AutomationAuditRow, retentionDays: number): Promise<void>;
  insertBatch(rows: AutomationAuditRow[], retentionDays: number): Promise<void>;
}

export class NullAutomationAuditRepository
  implements AutomationAuditRepository
{
  async insert(): Promise<void> {}
  async insertBatch(): Promise<void> {}
}
