import type { ObjectStorage } from "@langwatch/process-stores/members";

import { StoredObjectLegacyStorageRepository } from "../stored-object-legacy-storage.repository.ts";
import type { StoredObjectStorageRepository } from "../stored-object-storage.repository.ts";
import { ObjectStorageStoredObjectStorageRepository } from "./object-storage.stored-object-storage.repository.ts";

/** One project's legacy byte reads over the `objectStorage` store (ADR-158 §1). */
export class ObjectStorageStoredObjectLegacyStorageRepository extends StoredObjectLegacyStorageRepository {
  static create(objectStorage: ObjectStorage): ObjectStorageStoredObjectLegacyStorageRepository {
    return new ObjectStorageStoredObjectLegacyStorageRepository(objectStorage);
  }

  private constructor(private readonly objectStorage: ObjectStorage) {
    super();
  }

  forProject(projectId: string): StoredObjectStorageRepository {
    return ObjectStorageStoredObjectStorageRepository.create({
      objectStorage: this.objectStorage,
      projectId,
    });
  }
}
