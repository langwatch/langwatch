import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AutomationAuditRepository } from "~/server/app-layer/automations/repositories/automation-audit.repository";

import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { AutomationAuditRecord } from "./automationAudit.mapProjection";

export class AutomationAuditAppendStore
  implements AppendStore<AutomationAuditRecord>
{
  constructor(private readonly repository: AutomationAuditRepository) {}

  async append(
    record: AutomationAuditRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.insert(
      { tenantId: String(context.tenantId), ...record },
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async bulkAppend(
    records: AutomationAuditRecord[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (records.length === 0) return;
    const tenantId = String(context.tenantId);
    await this.repository.insertBatch(
      records.map((record) => ({ tenantId, ...record })),
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }
}
