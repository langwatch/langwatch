import type { ObjectStorage } from "@langwatch/process-stores/members";

import { ObjectStorageStoredObjectBytesRepository } from "../object-storage/object-storage.stored-object-bytes.repository.ts";
import { ObjectStorageStoredObjectLegacyStorageRepository } from "../object-storage/object-storage.stored-object-legacy-storage.repository.ts";
import type { StoredObjectRepositories } from "../stored-object.repositories.ts";
import { MemoryStoredObjectRateLimitRepository } from "./memory.stored-object-rate-limit.repository.ts";
import { MemoryStoredObjectRecordRepository } from "./memory.stored-object-record.repository.ts";
import { MemoryStoredObjectSealRepository } from "./memory.stored-object-seal.repository.ts";
import { MemoryStoredObjectsRepository } from "./memory.stored-objects.repository.ts";

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
