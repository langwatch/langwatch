export interface NormalizedLogRecord {
  id: string;
  tenantId: string;
  traceId: string;
  spanId: string;
  timeUnixMs: number;
  severityNumber: number;
  severityText: string;
  body: string;
  attributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  scopeName: string;
  scopeVersion: string | null;
}
