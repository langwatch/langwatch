import { moduleApi } from "@langwatch/kernel/module-api";

import type { LogPiiRedactionLevel, LogPreparation } from "./log-preparation.types.ts";
import type { CanonicalTraceLogRecord } from "./log-record.ts";

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

export const LogApi = moduleApi<LogApi>()("log");
