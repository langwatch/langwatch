// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The installer, the transport declarations a process mounts, and the two
 * adapters that build what the installer's infrastructure asks for.
 */
export {
  scimServer,
  type ScimInfrastructure,
  type ScimManagementAudit,
  type ScimPlanProvider,
} from "./scim.server.ts";

// The four declared doors: three REST families and one tRPC namespace, each
// inert until a process mounts it on its own runtime.
export { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
export { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
export { scimProtocolErrorHandler, scimProtocolRest } from "./transport/scim-protocol.rest.ts";
export { scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export { PostgresScimAdapter, type PostgresScimAdapterOptions } from "./services/postgres-scim.service.ts";
export type {
  ScimSyncLifecycle,
  ScimRemovalOperation,
  ScimUserPushOperation,
} from "./app/scim.infrastructure.ts";
export { ScimDirectoryIdentityService } from "./services/scim-directory-identity.service.ts";
export type { ScimUserProvisioning } from "./services/scim-provisioning.service.ts";

/**
 * The durable directory-sync history: the SCIM boundary's own implementation of
 * `ScimSyncLifecycle`, stating what happened as facts on the connection's identity
 * aggregate. Was `platform/app/src/server/app-layer/identity/scim-sync-lifecycle.ts`.
 */
export {
  ScimSyncLifecycleAdapter,
  type ScimSyncLifecycleAdapterDeps,
} from "./services/scim-sync-lifecycle.service.ts";
