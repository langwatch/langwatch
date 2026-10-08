/**
 * The stores a process opens and the typed clients they hand its repository registries
 * (ARCHITECTURE.md §7). A module class never reads a store client itself.
 */
export {
  STORE_CLIENT_NAMES,
  type Cache,
  type Clock,
  type Encryption,
  type IdempotencyStore,
  type StoreClientName,
  type ObjectBodyFacts,
  type ObjectDigest,
  type ObjectStorage,
  type ObjectStorageDestination,
  type StoreClients,
  type RateLimitDecision,
  type RateLimiter,
  type SecretResolver,
  type StoresMemberSource,
  type SignedObjectUpload,
  type StoredObjectAddress,
  type Telemetry,
  type UploadFacts,
} from "./members.ts";
export {
  hostedMembers,
  MemberNotConfiguredError,
  MemberSuppliedUndefinedError,
  StoreNotAnsweringError,
  type ProcessMemberSource,
  type ProcessStores,
} from "./create-members.ts";
export type {
  ClickHouseConfig,
  ClickHousePrivateRoute,
  DatabaseConfig,
  EventingConfig,
  EventingGroupQueueConfig,
  EventingStoreConfig,
  ObjectStorageAccount,
  ObjectStorageAzureConfig,
  ObjectStorageAzureIdentity,
  ObjectStorageConfig,
  ObjectStoragePrivateAccount,
  ProcessConfig,
  RedisConfig,
} from "./config.ts";
export { aesEncryption, loggedTelemetry, resolvedSecrets, systemClock } from "./config-members.ts";
export { consumingEventing, producerEventing } from "./eventing-role.ts";
export type { EventingEventLogMembers } from "./eventing-members.ts";
export { redisCache, redisIdempotency, redisRateLimiter } from "./redis-members.ts";
export { memoryStores } from "./memory-stores.ts";
export { memorySessionState } from "./memory-session-state.ts";
export {
  cachedTenantDirectory,
  prismaTenantDirectory,
  privateTenantListing,
  type TenantDirectory,
} from "./tenant-directory.ts";
export {
  ObjectBodyShortError,
  ObjectBodyTooLargeError,
  StoredObjectNotFoundError,
  UnknownStorageProjectError,
} from "./object-storage-backend.ts";
export {
  AzureBackendMisconfiguredError,
  AzureTokenExchangeError,
} from "./object-storage-azure-credentials.ts";

export { storesOwner, type StoresConfig } from "./config-owner.ts";
export {
  PipelineParticipation,
  ProducerPipelines,
  ConsumerPipelines,
  type PipelineSettings,
} from "./pipeline-selection.ts";
export { openStores } from "./open-stores.ts";
export { clickhouseRoutesOf } from "./clickhouse-routes.ts";
export { memoryObjectStorage } from "./object-storage-memory.ts";
