import type { CanonicalLogRecordAppendRepository } from "./canonical-log-record-append.repository.ts";

/** The rows this module owns: the canonical log records the pipeline appends. */
export interface LogRepositories {
  readonly logRecords: CanonicalLogRecordAppendRepository;
}
