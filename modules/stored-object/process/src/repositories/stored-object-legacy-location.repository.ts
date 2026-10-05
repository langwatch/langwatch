import type { StoredObjectStorageAddress } from "./stored-object-bytes.repository.ts";

/** Parses a legacy storage URI back into an address the new store recognises. */
export abstract class StoredObjectLegacyLocationRepository {
  abstract parse(input: {
    projectId: string;
    storageUri: string;
  }): Promise<StoredObjectStorageAddress> | StoredObjectStorageAddress;
}
