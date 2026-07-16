import { describe, expect, it, vi } from "vitest";
import type { MetricDataPointRepository } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../projections/stores";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

describe("canonical metric projection stores", () => {
  it("stamp trace retention on raw, catalog, and rollup writes", async () => {
    const ensureDataPoint = vi.fn(async () => {});
    const upsertSeries = vi.fn(async () => {});
    const recomputeAffectedRollups = vi.fn(async () => {});
    const repository = {
      ensureDataPoint,
      upsertSeries,
      recomputeAffectedRollups,
      queryUsageEstimates: async () => [],
    } satisfies MetricDataPointRepository;
    const context: ProjectionStoreContext = {
      aggregateId: "point",
      tenantId: createTenantId("project-1"),
      retentionPolicy: null,
    };
    const dataPoint = { pointId: "a".repeat(64) } as CanonicalMetricDataPoint;

    await new MetricDataPointAppendStore(repository).append(dataPoint, context);
    await new MetricSeriesCatalogAppendStore(repository).append(
      dataPoint,
      context,
    );
    await new MetricTimeRollupAppendStore(repository).append(
      dataPoint,
      context,
    );

    expect(ensureDataPoint).toHaveBeenCalledWith(
      dataPoint,
      PLATFORM_DEFAULT_RETENTION_DAYS,
    );
    expect(upsertSeries).toHaveBeenCalledWith(
      dataPoint,
      PLATFORM_DEFAULT_RETENTION_DAYS,
    );
    expect(recomputeAffectedRollups).toHaveBeenCalledWith(
      dataPoint,
      PLATFORM_DEFAULT_RETENTION_DAYS,
    );
  });
});
