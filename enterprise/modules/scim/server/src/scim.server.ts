// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM feature's installer: one application, four declared doors. A
 * process that composes the directory service, the plan source, the webhook
 * secret and the management audit ledger installs this and mounts what it
 * wants; one that composes none of them installs nothing.
 */
import { bindRestMiddleware, organizationCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";

import { ScimApp } from "./app/scim.app.ts";
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
  ])
  .build();
