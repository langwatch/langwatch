import { featureApi } from "@langwatch/runtime-composition/contract";
import type { CanonicalTraceLogRecord } from "./log-record.ts";
import type { LogPiiRedactionLevel, LogPreparation } from "./log.service.ts";

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
}

export const LogApi = featureApi<LogApi>("log");
