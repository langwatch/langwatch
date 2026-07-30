import type { MetricDataPointRepository } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { retentionDaysFrom } from "../../shared/analyticsStoreBase";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

export class MetricDataPointAppendStore
  implements AppendStore<CanonicalMetricDataPoint>
{
  constructor(private readonly repo: MetricDataPointRepository) {}

  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.ensureDataPoint({
      point,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }

  /** One repository call per chunk — replay writes these by the million. */
  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.ensureDataPoints({
      points,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }
}

export class MetricSeriesCatalogAppendStore
  implements AppendStore<CanonicalMetricDataPoint>
{
  constructor(private readonly repo: MetricDataPointRepository) {}

  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.upsertSeries({
      point,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }

  /** One repository call per chunk — replay writes these by the million. */
  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.upsertSeriesMany({
      points,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }
}

export class MetricTimeRollupAppendStore
  implements AppendStore<CanonicalMetricDataPoint>
{
  constructor(private readonly repo: MetricDataPointRepository) {}

  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.recomputeAffectedRollups({
      point,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }

  /** One repository call per chunk — replay writes these by the million. */
  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.recomputeAffectedRollupsMany({
      points,
      retentionDays: retentionDaysFrom(context, "traces"),
    });
  }
}
