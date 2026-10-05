import type { StoredObjectBytesRepository } from "./stored-object-bytes.repository.ts";
import type { StoredObjectLegacyStorageRepository } from "./stored-object-legacy-storage.repository.ts";
import type { StoredObjectRateLimitRepository } from "./stored-object-rate-limit.repository.ts";
import type { StoredObjectRecordRepository } from "./stored-object-record.repository.ts";
import type { StoredObjectSealRepository } from "./stored-object-seal.repository.ts";
import type { StoredObjectsRepository } from "./stored-objects.repository.ts";

export interface StoredObjectRepositories {
  readonly records: StoredObjectRecordRepository;
  /** Where an object's bytes are placed, written and read. */
  readonly bytes: StoredObjectBytesRepository;
  /** The read-only legacy ClickHouse index (ADR-158 §5), and the bytes its rows name. */
  readonly legacyIndex: StoredObjectsRepository;
  readonly legacyStorage: StoredObjectLegacyStorageRepository;
  /** The file door's per-caller read windows. */
  readonly rateLimits: StoredObjectRateLimitRepository;
  /** Seals the claims an upload or read URL carries (ADR-158 §4). */
  readonly seals: StoredObjectSealRepository;
}
