import type { CanonicalLogRecordRepository } from "./canonical-log-record.repository.ts";

/** The rows this module owns: the canonical log records, appended and read by trace. */
export interface LogRepositories {
  readonly logRecords: CanonicalLogRecordRepository;
}
