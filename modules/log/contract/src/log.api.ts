import { moduleApi } from "@langwatch/kernel/module-api";

import type { LogPiiRedactionLevel, LogPreparation } from "./log-preparation.types.ts";
import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "./log-record.ts";

/**
 * An OTLP log request's outcome. `unavailable` means nothing was durably accepted, so the sender
 * retries the whole request; `rejectedLogRecords` are refused for good and must not be re-sent.
 */
export type LogRequestCollectionResult =
  | {
      outcome: "collected";
      acceptedLogRecords: number;
      rejectedLogRecords: number;
      errorMessage?: string;
    }
  | { outcome: "unavailable"; errorMessage: string };

/** The portable canonical log capability shared by process features. */
export interface LogApi {
  prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation>;
  getLogsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]>;
  /** Prepares, records and correlates one OTLP log request (main: LogRequestCollectionService). */
  handleOtlpLogRequest(input: {
    tenantId: string;
    organizationId: string;
    logRequest: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
  }): Promise<LogRequestCollectionResult>;
  /** Sends prepared records onto the `log_processing` pipeline for durable storage. */
  recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void>;
}

export const LogApi = moduleApi<LogApi>()("log");
