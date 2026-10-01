// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The installer and the transport declarations a process mounts.
 */
export { scimServer } from "./scim.server.ts";

// The four declared doors: three REST families and one tRPC namespace, each
// inert until a process mounts it on its own runtime.
export { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
export { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
export { scimProtocolRest } from "./transport/scim-protocol.rest.ts";
export { scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export type {
  ScimSyncLifecycle,
  ScimRemovalOperation,
  ScimUserPushOperation,
} from "./services/scim-sync-lifecycle.service.ts";
export type { ScimUserProvisioning } from "./services/scim-provisioning.service.ts";
