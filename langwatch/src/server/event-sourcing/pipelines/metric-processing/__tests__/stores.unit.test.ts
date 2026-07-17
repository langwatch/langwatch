import { describe, expect, it, vi } from "vitest";
import type { MetricDataPointRepository } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { BulkAppendContext } from "~/server/event-sourcing/projections/mapProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../projections/stores";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

function makeRepository() {
  const calls = {
    ensureDataPoint: vi.fn(async () => {}),
    ensureDataPoints: vi.fn(async () => {}),
    upsertSeries: vi.fn(async () => {}),
    upsertSeriesMany: vi.fn(async () => {}),
    recomputeAffectedRollups: vi.fn(async () => {}),
    recomputeAffectedRollupsMany: vi.fn(async () => {}),
    queryUsageEstimates: async () => [],
  } satisfies MetricDataPointRepository;
  return calls;
}

const context: ProjectionStoreContext = {
  aggregateId: "point",
  tenantId: createTenantId("project-1"),
  retentionPolicy: null,
};

const dataPoint = { pointId: "a".repeat(64) } as CanonicalMetricDataPoint;

describe("canonical metric projection stores", () => {
  describe("when appending a single point", () => {
    it("stamps trace retention on raw, catalog, and rollup writes", async () => {
      const repository = makeRepository();

      await new MetricDataPointAppendStore(repository).append(
        dataPoint,
        context,
      );
      await new MetricSeriesCatalogAppendStore(repository).append(
        dataPoint,
        context,
      );
      await new MetricTimeRollupAppendStore(repository).append(
        dataPoint,
        context,
      );

      const write = {
        point: dataPoint,
        retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      };
      expect(repository.ensureDataPoint).toHaveBeenCalledWith(write);
      expect(repository.upsertSeries).toHaveBeenCalledWith(write);
      expect(repository.recomputeAffectedRollups).toHaveBeenCalledWith(write);
    });
  });

  describe("when replaying a chunk", () => {
    // Replay chunks arrive by the million; one repository call per chunk is
    // the difference between one round trip and one per point.
    it("hands the whole chunk to the repository in a single call", async () => {
      const repository = makeRepository();
      const points = [dataPoint, dataPoint, dataPoint];
      const bulkContext = context as BulkAppendContext;

      await new MetricDataPointAppendStore(repository).bulkAppend(
        points,
        bulkContext,
      );
      await new MetricSeriesCatalogAppendStore(repository).bulkAppend(
        points,
        bulkContext,
      );
      await new MetricTimeRollupAppendStore(repository).bulkAppend(
        points,
        bulkContext,
      );

      const bulkWrite = {
        points,
        retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
      };
      expect(repository.ensureDataPoints).toHaveBeenCalledExactlyOnceWith(
        bulkWrite,
      );
      expect(repository.upsertSeriesMany).toHaveBeenCalledExactlyOnceWith(
        bulkWrite,
      );
      expect(
        repository.recomputeAffectedRollupsMany,
      ).toHaveBeenCalledExactlyOnceWith(bulkWrite);
      expect(repository.ensureDataPoint).not.toHaveBeenCalled();
      expect(repository.upsertSeries).not.toHaveBeenCalled();
      expect(repository.recomputeAffectedRollups).not.toHaveBeenCalled();
    });
  });

  describe("when a chunk is empty", () => {
    it("does not touch the repository", async () => {
      const repository = makeRepository();

      await new MetricDataPointAppendStore(repository).bulkAppend(
        [],
        context as BulkAppendContext,
      );

      expect(repository.ensureDataPoints).not.toHaveBeenCalled();
    });
  });
});
