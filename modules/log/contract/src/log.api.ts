import { moduleApi } from "@langwatch/module";
import type { OtlpDoorRefusal, OtlpDoorRequest } from "@langwatch/otlp";
import type { OtlpIngestCredential } from "@langwatch/trace-contract";

import type { LogPiiRedactionLevel, LogPreparation, CanonicalLogRecord } from "./log-record.ts";

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

/** What `POST /api/otel/v1/logs` answers from: the collection, or the door's own refusal. */
export type LogOtlpDoorResult = LogRequestCollectionResult | OtlpDoorRefusal;

/** One OTLP log export to collect for a tenant, as main's `handleOtlpLogRequest` took it. */
export type LogCollectionInput = {
  tenantId: string;
  organizationId: string;
  logRequest: unknown;
  piiRedactionLevel: LogPiiRedactionLevel;
};

/** The portable canonical log capability shared by process features. */
export interface LogApi {
  prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation>;
  /** One exporter request the logs door verified: allowance, parse, then collection. */
  receiveOtlpLogs(input: {
    request: OtlpDoorRequest;
    credential: OtlpIngestCredential;
  }): Promise<LogOtlpDoorResult>;
  /** Prepares and records one OTLP log export, for a receiver that authenticated it itself. */
  collectOtlpLogs(input: LogCollectionInput): Promise<LogRequestCollectionResult>;
  /** Sends prepared records onto the `log_processing` pipeline for durable storage. */
  recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void>;
}

export const LogApi = moduleApi<LogApi>()("log");

/** Product ceilings, not deployment facts: no environment spells them. */
export const LOG_DEFAULT_RETENTION_DAYS = 30;
