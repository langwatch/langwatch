import type {
  CanonicalTraceLogRecord,
  LogPiiRedactionLevel,
  LogPreparation,
} from "@langwatch/log-contract";
import type { LogPreparationPort } from "../ports/log-preparation.port.ts";
import type { CanonicalLogRecordRepository } from "../repositories/canonical-log-record.repository.ts";

/** Canonical log preparation and the trace-scoped read, over one repository. */
export class LogService {
  private constructor(
    private readonly preparation: LogPreparationPort,
    private readonly repository: CanonicalLogRecordRepository,
  ) {}

  static create(deps: {
    preparation: LogPreparationPort;
    repository: CanonicalLogRecordRepository;
  }): LogService {
    return new LogService(deps.preparation, deps.repository);
  }

  prepareCanonicalLogRecords(input: {
    tenantId: string;
    organizationId: string;
    request: unknown;
    piiRedactionLevel: LogPiiRedactionLevel;
    acceptedAt?: number;
  }): Promise<LogPreparation> {
    return this.preparation.prepare(input);
  }

  getLogsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<CanonicalTraceLogRecord[]> {
    return this.repository.getLogsByTraceId(input);
  }
}
