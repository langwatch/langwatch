import type { ObjectStorage } from "@langwatch/process-stores/members";

import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../object-storage/object-storage.stored-object-bytes.repository.ts";
import { ObjectStorageStoredObjectLegacyStorageRepository } from "../object-storage/object-storage.stored-object-legacy-storage.repository.ts";
import type { StoredObjectRepositories } from "../stored-object.repositories.ts";
import { StoredObjectsRepository } from "../stored-objects.repository.ts";
import { MemoryStoredObjectRateLimitRepository } from "./memory.stored-object-rate-limit.repository.ts";
import { MemoryStoredObjectRecordRepository } from "./memory.stored-object-record.repository.ts";
import { MemoryStoredObjectSealRepository } from "./memory.stored-object-seal.repository.ts";

/**
 * The legacy ClickHouse index's memory twin. Nothing writes the index, so with
 * no ClickHouse in this tier every lookup answers "no such row".
 */
class MemoryStoredObjectsRepository extends StoredObjectsRepository {
  static create(): MemoryStoredObjectsRepository {
    return new MemoryStoredObjectsRepository();
  }

  private constructor() {
    super();
  }

  tryFindById = (_params: { projectId: string; id: string }): Promise<StoredObject | null> =>
    Promise.resolve(null);
}

/**
 * The "memory" tier. Bytes go to the memory stores' own `objectStorage` twin
 * (ADR-158), the one store this tier answers; every other repository is a twin here.
 */
export class MemoryStoredObjectRepositories {
  static readonly requires = ["objectStorage"] as const;

  static create({
    objectStorage,
  }: Readonly<{ objectStorage: ObjectStorage }>): StoredObjectRepositories {
    return {
      records: MemoryStoredObjectRecordRepository.create(),
      bytes: ObjectStorageStoredObjectBytesRepository.create({ objectStorage }),
      legacyIndex: MemoryStoredObjectsRepository.create(),
      legacyStorage: ObjectStorageStoredObjectLegacyStorageRepository.create(objectStorage),
      rateLimits: MemoryStoredObjectRateLimitRepository.create(),
      seals: MemoryStoredObjectSealRepository.create(),
    };
  }
}
