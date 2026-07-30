import type { LangyAnalyticsEventRepository } from "~/server/app-layer/langy/repositories/langy-analytics-event.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { retentionDaysFrom } from "../../shared/analyticsStoreBase";
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
      retentionDaysFrom(context, "traces"),
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
      retentionDaysFrom(context, "traces"),
    );
  }
}
