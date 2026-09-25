import { moduleApi } from "@langwatch/kernel/module-api";
import type { OtlpDoorRefusal, OtlpDoorRequest } from "@langwatch/otlp";
import { z } from "zod";

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

/** What `POST /api/otel/v1/logs` answers from: the collection, or the door's own refusal. */
export type LogOtlpDoorResult = LogRequestCollectionResult | OtlpDoorRefusal;

/** The exporter base a `/v1/logs` suffix was appended to; the receiver checks it. */
export const otlpLogAliasParamsSchema = z.object({ otlpBase: z.string() });

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
  /** One exporter request at the logs door: key, allowance, parse, then collection. */
  receiveOtlpLogs(request: OtlpDoorRequest): Promise<LogOtlpDoorResult>;
  /** Sends prepared records onto the `log_processing` pipeline for durable storage. */
  recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void>;
}

export const LogApi = moduleApi<LogApi>()("log");
