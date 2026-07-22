import type { MetricDataPointRepository } from "~/server/event-sourcing/ports/metric-data-point.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type {
  AppendStore,
  BulkAppendContext,
} from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

abstract class MetricStoreBase implements AppendStore<CanonicalMetricDataPoint> {
  constructor(protected readonly repo: MetricDataPointRepository) {}

  protected retention(
    context: ProjectionStoreContext | BulkAppendContext,
  ): number {
    return context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
  }

  abstract append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void>;

  /** One repository call per chunk — replay writes these by the million. */
  abstract bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void>;
}

export class MetricDataPointAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.ensureDataPoint({
      point,
      retentionDays: this.retention(context),
    });
  }

  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.ensureDataPoints({
      points,
      retentionDays: this.retention(context),
    });
  }
}

export class MetricSeriesCatalogAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.upsertSeries({
      point,
      retentionDays: this.retention(context),
    });
  }

  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.upsertSeriesMany({
      points,
      retentionDays: this.retention(context),
    });
  }
}

export class MetricTimeRollupAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.recomputeAffectedRollups({
      point,
      retentionDays: this.retention(context),
    });
  }

  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    if (points.length === 0) return;
    await this.repo.recomputeAffectedRollupsMany({
      points,
      retentionDays: this.retention(context),
    });
  }
}
