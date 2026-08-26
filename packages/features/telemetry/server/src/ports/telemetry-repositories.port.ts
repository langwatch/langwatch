import type {
  CanonicalLogRecord,
  CanonicalMetricDataPoint,
} from "@langwatch/telemetry-contract";

export abstract class CanonicalLogRecordAppendPort {
  abstract ensureLogRecord(
    record: CanonicalLogRecord,
    retentionDays?: number,
  ): Promise<void>;
  abstract ensureLogRecords(
    records: CanonicalLogRecord[],
    retentionDays?: number,
  ): Promise<void>;
}

export abstract class MetricDataPointAppendPort {
  abstract ensureDataPoint(args: {
    point: CanonicalMetricDataPoint;
    retentionDays?: number;
  }): Promise<void>;
  abstract ensureDataPoints(args: {
    points: CanonicalMetricDataPoint[];
    retentionDays?: number;
  }): Promise<void>;
  abstract upsertSeries(args: {
    point: CanonicalMetricDataPoint;
    retentionDays?: number;
  }): Promise<void>;
  abstract upsertSeriesMany(args: {
    points: CanonicalMetricDataPoint[];
    retentionDays?: number;
  }): Promise<void>;
  abstract recomputeAffectedRollups(args: {
    point: CanonicalMetricDataPoint;
    retentionDays?: number;
  }): Promise<void>;
  abstract recomputeAffectedRollupsMany(args: {
    points: CanonicalMetricDataPoint[];
    retentionDays?: number;
  }): Promise<void>;
}
