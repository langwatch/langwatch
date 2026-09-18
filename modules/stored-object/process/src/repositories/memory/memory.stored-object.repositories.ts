import type { StoredObjectRepositories } from "../stored-object.repositories.ts";
import { MemoryStoredObjectRecordRepository } from "./memory.stored-object-record.repository.ts";

export class MemoryStoredObjectRepositories {
  static readonly requires = [] as const;

  static create(): StoredObjectRepositories {
    return { records: MemoryStoredObjectRecordRepository.create() };
  }
}
