import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "./log-record";

export type LogPiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

export type PreparedCanonicalLogRecord = {
  record: CanonicalLogRecord;
  normalized: {
    body: string;
    attributes: Record<string, string>;
    resourceAttributes: Record<string, string>;
    scopeName: string;
    scopeVersion: string | null;
  };
};

export type LogPreparation = {
  accepted: PreparedCanonicalLogRecord[];
  rejectedLogRecords: number;
  errors: string[];
};

/** The sole ordinary-caller boundary for canonical log preparation and reads. */
export abstract class LogService {
  abstract prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation>;

  abstract getLogsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]>;
}
