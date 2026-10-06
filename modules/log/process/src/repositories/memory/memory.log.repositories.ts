import type { LogRepositories } from "../log.repositories.ts";
import { MemoryCanonicalLogRecordRepository } from "./memory.canonical-log-record.repository.ts";

/** The memory tier: the canonical log records held in the process, with no store. */
export class MemoryLogRepositories {
  static readonly requires = [] as const;

  static create(): LogRepositories {
    return { logRecords: MemoryCanonicalLogRecordRepository.create() };
  }
}
