/**
 * The members a process hands its modules, and the function that builds them
 * from parsed config. No pool noun on purpose: a module names the members it
 * reads with {@link reads} and is handed exactly those.
 */
export {
  MEMBER_NAMES,
  reads,
  type Cache,
  type Clock,
  type Encryption,
  type IdempotencyStore,
  type Mail,
  type MailMessage,
  type MemberName,
  type MembersRead,
  type ObjectStorage,
  type ProcessMembers,
  type RateLimitDecision,
  type RateLimiter,
  type SecretResolver,
  type StoredObject,
  type StoredObjectAddress,
  type Telemetry,
} from "./members.ts";
export {
  createProcessMembers,
  MemberNotConfiguredError,
  MemberSuppliedUndefinedError,
  type MemberSource,
  type ProcessMemberSource,
} from "./create-members.ts";
export type {
  ClickHouseConfig,
  ClickHousePrivateRoute,
  DatabaseConfig,
  EventingConfig,
  EventingGroupQueueConfig,
  EventingStoreConfig,
  MailConfig,
  MailProvider,
  ObjectStorageAccount,
  ObjectStorageConfig,
  ObjectStoragePrivateAccount,
  OutboundProxyConfig,
  ProcessConfig,
  RedisConfig,
} from "./config.ts";
export { aesEncryption, loggedTelemetry, resolvedSecrets, systemClock } from "./config-members.ts";
export { consumingEventing, producerEventing } from "./eventing-role.ts";
export type { EventingEventLogMembers } from "./eventing-members.ts";
export { redisCache, redisIdempotency, redisRateLimiter } from "./redis-members.ts";
export { memoryStores } from "./memory-stores.ts";
export {
  cachedTenantDirectory,
  prismaTenantDirectory,
  type TenantDirectory,
} from "./tenant-directory.ts";
export { UnknownStorageProjectError } from "./object-storage-member.ts";

export { hostedMembers } from "./hosted-members.ts";

export { storesOwner, type StoresConfig } from "./config-owner.ts";
export {
  PipelineParticipation,
  ProducerPipelines,
  ConsumerPipelines,
} from "./pipeline-selection.ts";
export { openProcessStores } from "./open-stores.ts";
