import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";

import type {
  AutomationAuditRepository,
  AutomationAuditRow,
} from "./automation-audit.repository";

const TABLE_NAME = "automation_audit" as const;
const logger = createLogger("langwatch:triggers:automation-audit-repository");

function validateBatch(rows: AutomationAuditRow[]): string | null {
  const tenantId = rows[0]?.tenantId;
  if (!tenantId) return null;
  for (const row of rows) {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "ClickHouseAutomationAuditRepository.insertBatch",
    );
    if (row.tenantId !== tenantId) {
      throw new Error("Automation audit batch must contain one tenant");
    }
  }
  return tenantId;
}

export class ClickHouseAutomationAuditRepository
  implements AutomationAuditRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insert(row: AutomationAuditRow, retentionDays: number): Promise<void> {
    await this.insertRows({ rows: [row], retentionDays, waitForInsert: false });
  }

  async insertBatch(
    rows: AutomationAuditRow[],
    retentionDays: number,
  ): Promise<void> {
    await this.insertRows({ rows, retentionDays, waitForInsert: true });
  }

  private async insertRows({
    rows,
    retentionDays,
    waitForInsert,
  }: {
    rows: AutomationAuditRow[];
    retentionDays: number;
    waitForInsert: boolean;
  }): Promise<void> {
    const tenantId = validateBatch(rows);
    if (tenantId === null) return;
    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: rows.map((row) => ({
          TenantId: row.tenantId,
          EventId: row.eventId,
          TriggerId: row.triggerId,
          TraceId: row.traceId,
          ActionClass: row.actionClass,
          OccurredAt: new Date(row.occurredAtMs),
          _retention_days: retentionDays,
        })),
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: waitForInsert ? 1 : 0,
        },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          rowCount: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert automation audit rows",
      );
      throw error;
    }
  }
}
