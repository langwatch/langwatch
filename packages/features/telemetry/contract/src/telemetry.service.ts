import type { CanonicalLogRecord } from "./schemas/log-processing/log-record";
import type {
  CanonicalMetricDataPoint,
  MetricTraceCorrelation,
} from "./schemas/metric-processing/metric-data-point";

export type TelemetryPiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

export type TelemetryLogRedactionService = {
  redactLog(
    input: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    level: TelemetryPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
};

export type TelemetryMetricRedactionService = {
  redactMetricAttributes(
    input: {
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    level: TelemetryPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
};

export type PreparedTelemetryLogRecord = {
  record: CanonicalLogRecord;
  normalized: {
    body: string;
    attributes: Record<string, string>;
    resourceAttributes: Record<string, string>;
    scopeName: string;
    scopeVersion: string | null;
  };
};

export type TelemetryLogPreparation = {
  accepted: PreparedTelemetryLogRecord[];
  rejectedLogRecords: number;
  errors: string[];
};

export type PreparedTelemetryMetricPoint = {
  dataPoint: CanonicalMetricDataPoint;
  correlations: MetricTraceCorrelation[];
};

export type TelemetryMetricPreparation = {
  accepted: PreparedTelemetryMetricPoint[];
  rejectedDataPoints: number;
  errors: string[];
};

/** The one ordinary-caller boundary for canonical OTLP preparation. */
export abstract class TelemetryService {
  abstract prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: TelemetryPiiRedactionLevel;
    redactionService: TelemetryLogRedactionService;
    acceptedAt?: number;
  }): Promise<TelemetryLogPreparation>;

  abstract prepareMetricDataPoints(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: TelemetryPiiRedactionLevel;
    redactionService: TelemetryMetricRedactionService;
    acceptedAt?: number;
  }): Promise<TelemetryMetricPreparation>;
}
