/**
 * The feature's application: the one typed thing its transports are given.
 * Every door reaches the same object, so a rule written on it is the rule
 * every door gets.
 */
export {
  ScimApp,
  type IssuedScimToken,
  type ScimAppDependencies,
  type ScimPlanProvider,
} from "./app/scim.app";
export {
  ScimTokenTrpcApi,
  type ScimTokenTrpcContext,
  type ScimTokenTrpcPorts,
} from "./api/app-trpc/scim-token.api";
export { createScimTokensRestApp } from "./api/app-rest/scim.api";
export * from "./api/scim/scim.api";
export { ScimWebhookApi } from "./api/scim-webhook/scim-webhook.api";
export { PostgresScimAdapter, type PostgresScimAdapterOptions } from "./adapters/scim.adapter";
export {
  ScimSyncLifecyclePort,
  type ScimRemovalOperation,
  type ScimUserPushOperation,
} from "./ports/scim-sync-lifecycle.port";
export { ScimDirectoryIdentityService } from "./services/scim-directory-identity.service";
