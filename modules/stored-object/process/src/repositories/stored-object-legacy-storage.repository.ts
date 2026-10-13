import type { StoredObjectStorageRepository } from "./stored-object-storage.repository.ts";

/** The legacy index's byte reads, scoped to the project whose bucket holds them. */
export abstract class StoredObjectLegacyStorageRepository {
  abstract forProject(projectId: string): StoredObjectStorageRepository;
}
