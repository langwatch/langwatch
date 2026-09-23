import { moduleApi } from "@langwatch/kernel/module-api";

import type { LogPiiRedactionLevel, LogPreparation } from "./log-preparation.types.ts";
import type { CanonicalLogRecord, CanonicalTraceLogRecord } from "./log-record.ts";

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
  /** Sends prepared records onto the `log_processing` pipeline for durable storage. */
  recordCanonicalLogRecords(records: readonly CanonicalLogRecord[]): Promise<void>;
}

export const LogApi = moduleApi<LogApi>()("log");
