// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM feature's installer: one application, four declared doors. A
 * process that composes the directory service, the plan source, the webhook
 * secret and the management audit ledger installs this and mounts what it
 * wants; one that composes none of them installs nothing.
 */
import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";

import type { ScimService as ScimServiceContract } from "@langwatch/enterprise-scim-contract";

import { ScimApp } from "./app/scim.app.ts";
import type { ScimSyncLifecycle } from "./app/scim.members.ts";
import {
  PostgresScimAdapter,
  type PostgresScimAdapterOptions,
} from "./services/postgres-scim.service.ts";
import {
  ScimSyncLifecycleAdapter,
  type ScimSyncLifecycleAdapterDeps,
} from "./services/scim-sync-lifecycle.service.ts";
import { scimProtocolRest } from "./transport/scim-protocol.rest.ts";
import { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
import { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
import { scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export type {
  ScimInfrastructure,
  ScimManagementAudit,
  ScimPlanProvider,
} from "./app/scim.app.ts";

export const scimServer = defineServerModule("scim")
  .withApp(ScimApp)
  .withTransports(scimTokenRest, scimTokenTrpcTransport, scimProtocolRest, scimWebhookRest)
  // Who a management key stands for: the member it acts as, or the key itself
  // where it acts as nobody - one stable string per credential either way.
  .withTransportFacts(() => [
    bindRestMiddleware(scimTokenRestActor, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { actorId: credential.userId ?? `apikey:${credential.apiKeyId}` };
    }),
  ]);

export type { PostgresScimAdapterOptions, ScimSyncLifecycleAdapterDeps };

/**
 * What a process composes SCIM from: the provisioning service over its own
 * connection and peers, and the durable directory-sync history that states what
 * happened as facts on the connection's identity aggregate. The adapters behind
 * them stay private to this feature server.
 */
export function createScimService(options: PostgresScimAdapterOptions): ScimServiceContract {
  return PostgresScimAdapter.create(options).build();
}

/** The durable directory-sync history for one deployment. */
export function createScimSyncLifecycle(deps: ScimSyncLifecycleAdapterDeps): ScimSyncLifecycle {
  return ScimSyncLifecycleAdapter.create(deps);
}
