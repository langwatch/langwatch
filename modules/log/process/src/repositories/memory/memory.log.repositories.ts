import type { LogRepositories } from "../log.repositories.ts";
import { MemoryCanonicalLogRecordAppendRepository } from "./memory.canonical-log-record-append.repository.ts";

/** The memory tier: the canonical log records held in the process, with no store. */
export class MemoryLogRepositories {
  static readonly requires = [] as const;

  static create(): LogRepositories {
    return { logRecords: MemoryCanonicalLogRecordAppendRepository.create() };
  }
}
