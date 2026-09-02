import type { CanonicalTraceLogRecord } from "@langwatch/log-contract";
import { CanonicalLogRecordAppendRepository } from "./canonical-log-record-append.repository";

/**
 * The whole canonical-log surface: the append port durable processing uses,
 * plus the trace-scoped read only a query graph makes.
 */
export abstract class CanonicalLogRecordRepository extends CanonicalLogRecordAppendRepository {
  abstract getLogsByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]>;
}
