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
} from "./transport/api-trpc/scim-token.api";
export { createScimTokensRestApp } from "./transport/api-rest/scim.api";
// The SCIM 2.0 protocol family itself, and the Auth0 webhook intake beside it.
// Both take the application as a provider rather than a request context, so a
// process that composed no Enterprise SCIM cannot mount either by accident.
export { createScimProtocolRestApp } from "./transport/api-rest/scim-protocol.api";
export {
  createScimWebhookRestApp,
  type ScimWebhookRestPorts,
} from "./transport/api-rest/scim-webhook-intake.api";
export * from "./api/scim/scim.api";
export { ScimWebhookApi } from "./api/scim-webhook/scim-webhook.api";
export { PostgresScimAdapter, type PostgresScimAdapterOptions } from "./adapters/scim.adapter";
export {
  ScimSyncLifecyclePort,
  type ScimRemovalOperation,
  type ScimUserPushOperation,
} from "./ports/scim-sync-lifecycle.port";
export { ScimDirectoryIdentityService } from "./services/scim-directory-identity.service";

/**
 * The durable directory-sync history: the SCIM boundary's own implementation
 * of `ScimSyncLifecyclePort`, stating what happened as facts on the
 * connection's identity aggregate. Was
 * `platform/app/src/server/app-layer/identity/scim-sync-lifecycle.ts`.
 */
export {
  ScimSyncLifecycle,
  type ScimSyncLifecycleDeps,
} from "./adapters/identity.scim-sync-lifecycle.adapter";
