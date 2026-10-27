/**
 * The stores a process opens and the typed clients they hand its repository registries
 * (ARCHITECTURE.md §7). A module class never reads a store client itself.
 */
export {
  STORE_CLIENT_NAMES,
  type Encryption,
  type ObjectDigest,
  type ObjectStorage,
  type ObjectStorageDestination,
  type RateLimitDecision,
  type RateLimiter,
  type StoresMemberSource,
  type SignedObjectUpload,
  type StoredObjectAddress,
} from "./members.ts";
export {
  hostedStores,
  MemberNotConfiguredError,
  type ProcessMemberSource,
} from "./create-members.ts";
export type { ProcessConfig } from "./config.ts";
export { aesEncryption, resolvedSecrets, systemClock } from "./config-members.ts";
export { redisRateLimiter } from "./redis-members.ts";
export { memoryStores, type MemoryStores } from "./memory-stores.ts";
export { memorySessionState } from "./memory-session-state.ts";
export { privateTenantListing } from "./tenant-directory.ts";
export {
  ObjectBodyShortError,
  ObjectBodyTooLargeError,
  StoredObjectNotFoundError,
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
} from "./pipeline-selection.ts";
export { openStores } from "./open-stores.ts";
export { clickhouseRoutesOf } from "./clickhouse-routes.ts";
export { OverloadedRefusal, StatementBoundTelemetry } from "./clickhouse-member.ts";
export { memoryObjectStorage } from "./object-storage-memory.ts";
