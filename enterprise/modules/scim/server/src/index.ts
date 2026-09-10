// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The installer, the transport declarations a process mounts, and the two
 * adapters that build what the installer's infrastructure asks for.
 */
export {
  scimServer,
  type ScimInfrastructure,
  type ScimManagementAuditPort,
  type ScimPlanProvider,
} from "./scim.server.ts";

// The four declared doors: three REST families and one tRPC namespace, each
// inert until a process mounts it on its own runtime.
export { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
export { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
export { scimProtocolErrorHandler, scimProtocolRest } from "./transport/scim-protocol.rest.ts";
export { scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export { PostgresScimAdapter, type PostgresScimAdapterOptions } from "./services/postgres-scim.service.ts";
export {
  ScimSyncLifecyclePort,
  type ScimRemovalOperation,
  type ScimUserPushOperation,
} from "./ports/scim-sync-lifecycle.port.ts";
export { ScimDirectoryIdentityService } from "./services/scim-directory-identity.service.ts";
export type { ScimUserProvisioning } from "./services/scim-provisioning.service.ts";

/**
 * The durable directory-sync history: the SCIM boundary's own implementation of
 * `ScimSyncLifecyclePort`, stating what happened as facts on the connection's identity
 * aggregate. Was `platform/app/src/server/app-layer/identity/scim-sync-lifecycle.ts`.
 */
export {
  ScimSyncLifecycleAdapter,
  type ScimSyncLifecycleAdapterDeps,
} from "./services/scim-sync-lifecycle.service.ts";
