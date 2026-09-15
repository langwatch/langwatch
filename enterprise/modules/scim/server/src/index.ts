// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The installer, the transport declarations a process mounts, and the two
 * adapters that build what the installer's members asks for.
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

export type {
  ScimSyncLifecycle,
  ScimRemovalOperation,
  ScimUserPushOperation,
} from "./app/scim.members.ts";
export type { ScimUserProvisioning } from "./services/scim-provisioning.service.ts";

/**
 * What a process composes SCIM from: the provisioning service over its own
 * connection, and the durable directory-sync history that states what happened
 * as facts on the connection's identity aggregate.
 */
export {
  createScimService,
  createScimSyncLifecycle,
  type PostgresScimAdapterOptions,
  type ScimSyncLifecycleAdapterDeps,
} from "./scim.server.ts";
