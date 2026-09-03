export type OtlpAnyValue = {
  stringValue?: string | null;
  intValue?: string | number | null;
  doubleValue?: number | null;
  boolValue?: boolean | null;
};

export type OtlpKeyValue = { key?: string; value?: OtlpAnyValue };
export type OtlpFixed64 = string | number | { low: number; high: number };
export type OtlpLogRecord = {
  attributes?: OtlpKeyValue[];
  timeUnixNano?: OtlpFixed64;
};
export type OtlpLogsRequest = {
  resourceLogs?: Array<{
    resource?: { attributes?: OtlpKeyValue[] };
    scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
  }>;
};

export type CanonicalCostEvent = {
  costUsd: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requestId: string;
  occurredAt: Date;
  userEmail: string | null;
  teamIdHint: string | null;
  raw: Record<string, unknown>;
};
