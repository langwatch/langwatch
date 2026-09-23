// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM feature's installer: one application, four declared doors.
 * `ScimApp` declares what it reads off the process and which peer modules it
 * depends on; a process that supplies both, plus the directory-sync history
 * `createScimSyncLifecycle` builds, installs this and mounts what it wants.
 */
import {
  bindRestMiddleware,
  organizationCredentialOfRequest,
  scimCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { ScimApp } from "./app/scim.app.ts";
import type { ScimSyncLifecycle } from "./app/scim.members.ts";
import { scimEventing } from "./eventing/scim.pipeline.ts";
import { scimRepositories } from "./repositories/scim-repositories.registry.ts";
import { SCIM_WEBHOOK_SIGNATURE_HEADER } from "./rules/scim-webhook-signature.rules.ts";
import {
  ScimSyncLifecycleService,
  type ScimSyncLifecycleAdapterDeps,
} from "./services/scim-sync-lifecycle.service.ts";
import { scimOversightTrpcTransport } from "./transport/scim-oversight.trpc.ts";
import { scimProtocolRest, scimRestCredential } from "./transport/scim-protocol.rest.ts";
import { scimReconciliationTrpcTransport } from "./transport/scim-reconciliation.trpc.ts";
import { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
import { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
import { scimWebhookDelivery, scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export type { ScimBespokeMembers } from "./app/scim.app.ts";

export const scimServer = defineServerModule("scim")
  .withRepositories(scimRepositories)
  .withApp(ScimApp)
  .withTransports(
    scimTokenRest,
    scimTokenTrpcTransport,
    scimReconciliationTrpcTransport,
    scimOversightTrpcTransport,
    scimProtocolRest,
    scimWebhookRest,
  )
  // Who a management key stands for: the member it acts as, or the key itself
  // where it acts as nobody - one stable string per credential either way.
  .withTransportFacts(() => [
    bindRestMiddleware(scimTokenRestActor, (context) => {
      const credential = organizationCredentialOfRequest(context.req.raw);

      return { actorId: credential.userId ?? `apikey:${credential.apiKeyId}` };
    }),
    bindRestMiddleware(scimRestCredential, (context) => {
      const credential = scimCredentialOfRequest(context.req.raw);

      return { connectionId: credential.connectionId };
    }),
    bindRestMiddleware(scimWebhookDelivery, (context) => ({
      signature: context.req.header(SCIM_WEBHOOK_SIGNATURE_HEADER) ?? null,
      authorization: context.req.header("authorization") ?? null,
    })),
  ])
  .withEventing(scimEventing);

export type { ScimSyncLifecycleAdapterDeps };

/**
 * The durable directory-sync history for one deployment: the one input
 * `ScimApp` cannot build from `reads()` or a peer alone (see
 * `ScimBespokeMembers`). The adapter behind it stays private to this feature
 * server.
 */
export function createScimSyncLifecycle(deps: ScimSyncLifecycleAdapterDeps): ScimSyncLifecycle {
  return ScimSyncLifecycleService.create(deps);
}
