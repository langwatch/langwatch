import type { MetricDataPointRepository } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
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

  async bulkAppend(
    points: CanonicalMetricDataPoint[],
    context: BulkAppendContext,
  ): Promise<void> {
    for (const point of points) {
      await this.append(point, context as ProjectionStoreContext);
    }
  }
}

export class MetricDataPointAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.ensureDataPoint(point, this.retention(context));
  }
}

export class MetricSeriesCatalogAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.upsertSeries(point, this.retention(context));
  }
}

export class MetricTimeRollupAppendStore extends MetricStoreBase {
  async append(
    point: CanonicalMetricDataPoint,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.recomputeAffectedRollups(point, this.retention(context));
  }
}
