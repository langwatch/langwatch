import type { StoredObjectStorageAddress } from "#app/stored-object.members";

/** Parses a legacy storage URI back into an address the new store recognises. */
export abstract class StoredObjectLegacyLocation {
  abstract parse(input: {
    projectId: string;
    storageUri: string;
  }): Promise<StoredObjectStorageAddress> | StoredObjectStorageAddress;
}
