export interface NormalizedMetricRecord {
  id: string;
  tenantId: string;
  traceId: string;
  spanId: string;
  metricName: string;
  metricUnit: string;
  metricType: string;
  value: number;
  timeUnixMs: number;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
}
