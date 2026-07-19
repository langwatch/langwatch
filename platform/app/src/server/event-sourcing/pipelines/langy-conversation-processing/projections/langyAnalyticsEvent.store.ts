import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { LangyAnalyticsEventRepository } from "~/server/app-layer/langy/repositories/langy-analytics-event.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { LangyAnalyticsEventProjectionRecord } from "./langyAnalyticsEvent.mapProjection";

/** App-layer adapter for the analytics-only ClickHouse event sink. */
export class LangyAnalyticsEventAppendStore
  implements AppendStore<LangyAnalyticsEventProjectionRecord>
{
  constructor(private readonly repository: LangyAnalyticsEventRepository) {}

  async append(
    record: LangyAnalyticsEventProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repository.insert(
      { tenantId: String(context.tenantId), ...record },
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  }

  async bulkAppend(
    records: LangyAnalyticsEventProjectionRecord[],
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
