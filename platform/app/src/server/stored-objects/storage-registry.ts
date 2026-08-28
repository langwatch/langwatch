/**
 * Compatibility export for app callers. Scheme dispatch is owned by the
 * Stored Object server package; the app continues to construct its existing
 * provider drivers and injects them here.
 */
export {
  StoredObjectStorageRegistry as StorageRegistry,
  type StoredObjectStorageDriver as StorageDriver,
  type StoredObjectStorageDriverFactory as StorageDriverFactory,
} from "@langwatch/stored-object-server/storage";
