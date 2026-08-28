export {
  StoredObjectDestinationPolicy,
  StoredObjectAzureDestinationPort,
  StoredObjectProjectS3ConfigPort,
  type StoredObjectStorageSelection,
} from "./adapters/stored-object-destination.policy";
export {
  StoredObjectStorageRegistry,
  type StoredObjectStorageDriver,
  type StoredObjectStorageDriverFactory,
} from "./adapters/stored-object-storage.registry";
export {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntime,
  type StoredObjectByteStore,
  type StoredObjectStorageProject,
  type StoredObjectStorageRuntimeOptions,
} from "./adapters/stored-object-storage.runtime";
