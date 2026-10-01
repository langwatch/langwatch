import type { StoredObjectRecordRepository } from "./stored-object-record.repository.ts";

export interface StoredObjectRepositories {
  readonly records: StoredObjectRecordRepository;
}
